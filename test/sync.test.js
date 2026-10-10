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
  await sync.handleEvent('issues', { action: 'assigned', issue: { node_id: 'I_mine' } });
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
  assert.deepEqual(await sync.backfill(), { created: 1, updated: 0, deleted: 1, skipped: 1 });
  assert.deepEqual((await store.all()).map((r) => r.itemId), ['new']);
  assert.deepEqual(await sync.backfill(), { created: 0, updated: 1, deleted: 0, skipped: 1 });
});
