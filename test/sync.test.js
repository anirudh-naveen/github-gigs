import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DiscordError } from '../src/discord.js';
import { loadSettings } from '../src/settings.js';
import { createMemoryStore } from '../src/store.js';
import { createSync } from '../src/sync.js';

const settings = loadSettings('config/anilounge.json');
const PROJECT = 'PVT_gigs';

function item(id, over = {}) {
  return {
    id,
    projectId: PROJECT,
    isArchived: false,
    issue: {
      id: `I_${id}`,
      repo: 'anilounge/anilounge',
      number: 78,
      title: 'Avatars → R2',
      body: 'Move avatars.\n\n**Requirements**\n- Upload to R2',
      url: 'https://github.com/anilounge/anilounge/issues/78',
      state: 'OPEN',
      labels: ['backend'],
      ...over.issue,
    },
    fields: { status: 'Open', difficulty: 'Medium', bounty: '', area: 'Backend', ...over.fields },
    ...over.top,
  };
}

function setup() {
  const items = new Map();
  const calls = [];
  const threads = new Set();
  let next = 100;
  const github = {
    async getItem(id) {
      await new Promise((r) => setImmediate(r));
      return items.get(id) ?? null;
    },
    async itemsForIssue(issueId, projectId) {
      return [...items.values()]
        .filter((i) => i.issue?.id === issueId && i.projectId === projectId)
        .map((i) => i.id);
    },
    async listItems() {
      return [...items.keys()];
    },
  };
  const discord = {
    async getForumTags() {
      return [{ id: 't-backend', name: 'Backend' }, { id: 't-medium', name: 'Medium' }];
    },
    async createPost(channelId, post) {
      const id = String(next++);
      threads.add(id);
      calls.push(['create', channelId, post]);
      return id;
    },
    async updatePost(threadId, update) {
      if (!threads.has(threadId)) throw new DiscordError(404, 'PATCH', `/channels/${threadId}`, '');
      calls.push(['update', threadId, update]);
    },
    async deletePost(threadId) {
      threads.delete(threadId);
      calls.push(['delete', threadId]);
    },
  };
  const store = createMemoryStore();
  const sync = createSync({
    github, discord, store, settings, channelId: 'forum', projectId: PROJECT, log: () => {},
  });
  return { items, calls, threads, store, sync };
}

test('an Open gig gets a post with tags and a stored thread id', async () => {
  const { items, calls, store, sync } = setup();
  items.set('PVTI_1', item('PVTI_1'));
  assert.equal(await sync.reconcile('PVTI_1'), 'created');
  const [kind, channel, post] = calls[0];
  assert.equal(kind, 'create');
  assert.equal(channel, 'forum');
  assert.equal(post.name, '#78 Avatars → R2');
  assert.deepEqual(post.applied_tags, ['t-backend', 't-medium']);
  assert.deepEqual(post.message.allowed_mentions, { parse: [] });
  assert.equal((await store.get('PVTI_1')).threadId, '100');
});

test('edits update the existing post instead of creating another', async () => {
  const { items, calls, sync } = setup();
  items.set('PVTI_1', item('PVTI_1'));
  await sync.reconcile('PVTI_1');
  items.set('PVTI_1', item('PVTI_1', { fields: { bounty: '$50' } }));
  assert.equal(await sync.reconcile('PVTI_1'), 'updated');
  assert.equal(calls.length, 2);
  assert.equal(calls[1][1], '100');
  assert.match(calls[1][2].message.content, /\*\*Bounty\*\*: \$50/);
});

for (const [why, change] of [
  ['Status = Done', { fields: { status: 'Done' } }],
  ['issue closed', { issue: { state: 'CLOSED' } }],
  ['item archived', { top: { isArchived: true } }],
  ['moved to private area', { fields: { area: 'Security' } }],
]) {
  test(`post is deleted when ${why}`, async () => {
    const { items, calls, store, sync } = setup();
    items.set('PVTI_1', item('PVTI_1'));
    await sync.reconcile('PVTI_1');
    items.set('PVTI_1', item('PVTI_1', change));
    assert.equal(await sync.reconcile('PVTI_1'), 'deleted');
    assert.deepEqual(calls.at(-1), ['delete', '100']);
    assert.equal(await store.get('PVTI_1'), null);
  });
}

test('post is deleted when the item leaves the Project', async () => {
  const { items, calls, sync } = setup();
  items.set('PVTI_1', item('PVTI_1'));
  await sync.reconcile('PVTI_1');
  items.delete('PVTI_1');
  await sync.handleEvent('projects_v2_item', {
    action: 'deleted',
    projects_v2_item: { node_id: 'PVTI_1', project_node_id: PROJECT },
  });
  assert.deepEqual(calls.at(-1), ['delete', '100']);
});

test('reopening posts it again', async () => {
  const { items, calls, sync } = setup();
  items.set('PVTI_1', item('PVTI_1', { issue: { state: 'CLOSED' } }));
  assert.equal(await sync.reconcile('PVTI_1'), 'skipped');
  items.set('PVTI_1', item('PVTI_1'));
  assert.equal(await sync.reconcile('PVTI_1'), 'created');
  assert.equal(calls.length, 1);
});

test('blank status, draft issues, and security gigs are never posted', async () => {
  const { items, calls, sync } = setup();
  items.set('a', item('a', { fields: { status: '' } }));
  items.set('b', item('b', { top: { issue: null } }));
  items.set('c', item('c', { issue: { labels: ['security'] } }));
  for (const id of ['a', 'b', 'c']) assert.equal(await sync.reconcile(id), 'skipped');
  assert.deepEqual(calls, []);
});

test('a post deleted by hand is recreated on the next edit', async () => {
  const { items, threads, sync } = setup();
  items.set('PVTI_1', item('PVTI_1'));
  await sync.reconcile('PVTI_1');
  threads.clear();
  assert.equal(await sync.reconcile('PVTI_1'), 'created');
});

test('simultaneous events for one item create only one post', async () => {
  const { items, calls, sync } = setup();
  items.set('PVTI_1', item('PVTI_1'));
  await Promise.all([sync.reconcile('PVTI_1'), sync.reconcile('PVTI_1'), sync.reconcile('PVTI_1')]);
  assert.equal(calls.filter((c) => c[0] === 'create').length, 1);
});

test('issue events reconcile that issue\'s items on this Project only', async () => {
  const { items, calls, sync } = setup();
  items.set('mine', item('mine'));
  items.set('theirs', item('theirs', { top: { projectId: 'PVT_other' } }));
  await sync.handleEvent('issues', { action: 'edited', issue: { node_id: 'I_mine' } });
  await sync.handleEvent('issues', { action: 'edited', issue: { node_id: 'I_theirs' } });
  await sync.handleEvent('issues', { action: 'milestoned', issue: { node_id: 'I_mine' } });
  assert.equal(calls.length, 1);
});

test('events for other Projects and reorders are ignored', async () => {
  const { items, calls, sync } = setup();
  items.set('PVTI_1', item('PVTI_1'));
  await sync.handleEvent('projects_v2_item', {
    action: 'edited', projects_v2_item: { node_id: 'PVTI_1', project_node_id: 'PVT_other' },
  });
  await sync.handleEvent('projects_v2_item', {
    action: 'reordered', projects_v2_item: { node_id: 'PVTI_1', project_node_id: PROJECT },
  });
  assert.deepEqual(calls, []);
});

test('backfill posts, refreshes, and cleans up items removed while down', async () => {
  const { items, store, sync } = setup();
  items.set('old', item('old'));
  await sync.reconcile('old');
  items.delete('old');
  items.set('new', item('new'));
  items.set('done', item('done', { fields: { status: 'Done' } }));
  assert.deepEqual(await sync.backfill(), { created: 1, updated: 0, moved: 0, deleted: 1, skipped: 1 });
  assert.deepEqual((await store.all()).map((r) => r.itemId), ['new']);
  assert.deepEqual(await sync.backfill(), { created: 0, updated: 1, moved: 0, deleted: 0, skipped: 1 });
});

// ---- Boards ----------------------------------------------------------------
import { resolveBoards } from '../src/boards.js';

function boardSetup() {
  const env = { CONTENT: 'content-forum', ART: 'art-forum' };
  const boards = resolveBoards(settings, { DISCORD_CONTENT_CHANNEL_ID: env.CONTENT, DISCORD_ART_CHANNEL_ID: env.ART }, 'code-forum');
  const t = setup();
  const posts = new Map();
  let next = 1;
  const discord = {
    tagsFor: [],
    async getForumTags(forumId) {
      discord.tagsFor.push(forumId);
      return [{ id: `${forumId}-claimed`, name: 'Claimed' }];
    },
    async createPost(forumId, post) {
      const id = String(next++);
      posts.set(id, { forumId, name: post.name });
      return id;
    },
    async updatePost(id) {
      if (!posts.has(id)) throw new DiscordError(404, 'PATCH', id, '');
    },
    async deletePost(id) {
      posts.delete(id);
    },
  };
  const sync = createSync({
    github: { getItem: async (id) => t.items.get(id) ?? null },
    discord, store: t.store, settings, channelId: 'code-forum', boards, projectId: PROJECT, log: () => {},
  });
  return { ...t, sync, posts, discord };
}

const forums = (posts) => [...posts.values()].map((p) => p.forumId);

test('boards: Type field, then labels, pick the forum; the rest go to the default', async () => {
  const { items, posts, sync } = boardSetup();
  items.set('code', item('code'));
  items.set('art', item('art', { fields: { type: 'Art' } }));
  items.set('content', item('content', { issue: { labels: ['content'] } }));
  items.set('both', item('both', { fields: { type: 'Art' }, issue: { labels: ['content'] } }));
  for (const id of ['code', 'art', 'content', 'both']) await sync.reconcile(id);
  assert.deepEqual(forums(posts), ['code-forum', 'art-forum', 'content-forum', 'content-forum']);
  assert.equal(sync.boardName('art-forum'), 'Art');
  assert.equal(sync.boardName(null), 'Code');
});

test('boards: changing Type moves the post to the new forum', async () => {
  const { items, posts, store, sync } = boardSetup();
  items.set('g', item('g'));
  await sync.reconcile('g');
  items.set('g', item('g', { fields: { type: 'Art' } }));
  assert.equal(await sync.reconcile('g'), 'moved');
  assert.deepEqual(forums(posts), ['art-forum']);
  assert.equal((await store.get('g')).channelId, 'art-forum');
  assert.equal(await sync.reconcile('g'), 'updated');
});

test('boards: a move keeps the claim', async () => {
  const { items, store, sync } = boardSetup();
  items.set('g', item('g'));
  await sync.reconcile('g');
  await store.setClaim('g', '1', 'octocat');
  items.set('g', item('g', { fields: { type: 'Content' } }));
  await sync.reconcile('g');
  assert.equal((await store.get('g')).claim.githubLogin, 'octocat');
});

test('boards: rows saved before boards existed count as the default board', async () => {
  const { items, posts, store, sync } = boardSetup();
  items.set('g', item('g'));
  await sync.reconcile('g');
  const row = await store.get('g');
  await store.save({ ...row, channelId: null });
  assert.equal(await sync.reconcile('g'), 'updated');
  assert.deepEqual(forums(posts), ['code-forum']);
});

test('boards: tags are fetched per forum', async () => {
  const { items, discord, sync } = boardSetup();
  items.set('a', item('a', { fields: { type: 'Art' } }));
  items.set('b', item('b'));
  items.set('c', item('c', { fields: { type: 'Art' } }));
  for (const id of ['a', 'b', 'c']) await sync.reconcile(id);
  assert.deepEqual(discord.tagsFor, ['art-forum', 'code-forum']);
});

test('boards: config errors are clear', () => {
  assert.throws(() => resolveBoards(settings, {}, 'code'), /DISCORD_CONTENT_CHANNEL_ID for the Content board/);
  assert.throws(
    () => resolveBoards(settings, { DISCORD_CONTENT_CHANNEL_ID: 'code', DISCORD_ART_CHANNEL_ID: 'x' }, 'code'),
    /its own forum channel/,
  );
  const plain = resolveBoards({ boards: [{ name: 'X', channel: '123', types: ['x'] }], defaultBoard: 'Gigs' }, {}, 'd');
  assert.deepEqual(plain.map((b) => [b.name, b.channelId]), [['X', '123'], ['Gigs', 'd']]);
});
