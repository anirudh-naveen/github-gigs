import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClaims } from '../src/claims.js';
import { readState, signState } from '../src/link.js';
import { loadSettings } from '../src/settings.js';
import { createMemoryStore } from '../src/store.js';
import { createSync } from '../src/sync.js';

const PROJECT = 'PVT_gigs';
const DAY = 24 * 60 * 60 * 1000;
const DEV = 'role-dev';
const MAINT = 'role-maint';

function setup({ approval = true, linking = true } = {}) {
  const settings = loadSettings('x', () => JSON.stringify({
    ...JSON.parse(JSON.stringify(loadSettings('config/anilounge.json'))),
    claims: { requireApproval: approval, maxActivePerUser: 2, expireDaysAfterLastCommit: 7 },
  }));
  const items = new Map();
  const gh = [];
  const commits = new Map();
  let failNext = false;

  const github = {
    linkingEnabled: linking,
    async getItem(id) {
      return items.has(id) ? structuredClone(items.get(id)) : null;
    },
    async itemsForIssue() {
      return [];
    },
    async listItems() {
      return [...items.keys()];
    },
    async assign(repo, number, login) {
      if (failNext) {
        failNext = false;
        throw new Error('boom');
      }
      gh.push(['assign', number, login]);
      const ok = login !== 'outsider';
      if (ok) [...items.values()].find((i) => i.issue.number === number).issue.assignees = [login];
      return ok;
    },
    async unassign(repo, number, login) {
      gh.push(['unassign', number, login]);
      [...items.values()].find((i) => i.issue.number === number).issue.assignees = [];
    },
    async comment(repo, number, body) {
      gh.push(['comment', number, body]);
    },
    async setField(projectId, itemId, field, value) {
      gh.push(['set', itemId, field, value]);
      items.get(itemId).fields[field.toLowerCase()] = value;
    },
    async lastCommitAt(issueId) {
      return commits.get(issueId) ?? null;
    },
    authorizeUrl: (state, redirect) => `https://github.test/authorize?state=${state}&redirect_uri=${redirect}`,
    async loginFromCode(code) {
      if (code !== 'good') throw new Error('bad code');
      return 'octocat';
    },
  };

  const threads = new Map();
  const discordCalls = [];
  let nextThread = 500;
  const discord = {
    async getForumTags() {
      return [{ id: 'tag-claimed', name: 'Claimed' }];
    },
    async createPost(channelId, post) {
      const id = String(nextThread++);
      threads.set(id, post.message.content);
      return id;
    },
    async updatePost(id, update) {
      threads.set(id, update.message.content);
    },
    async deletePost(id) {
      threads.delete(id);
    },
    async editOriginal(appId, token, body) {
      discordCalls.push(['edit', token, body]);
    },
    async sendMessage(channelId, body) {
      discordCalls.push(['send', channelId, body]);
    },
  };

  const store = createMemoryStore();
  const sync = createSync({ github, discord, store, settings, channelId: 'forum', projectId: PROJECT, log: () => {} });
  const config = {
    discord: { applicationId: 'app', maintainerRoleId: MAINT },
    github: { projectId: PROJECT, webhookSecret: 'secret' },
    publicUrl: 'https://bot.test',
  };
  const logs = [];
  const claims = createClaims({ github, discord, store, sync, settings, config, log: (m) => logs.push(m) });

  async function addGig(n, fields = {}) {
    const id = `PVTI_${n}`;
    items.set(id, {
      id,
      projectId: PROJECT,
      isArchived: false,
      issue: {
        id: `I_${n}`, repo: 'o/r', number: n, title: `Gig ${n}`, body: 'Do it.', url: `https://gh/o/r/${n}`,
        state: 'OPEN', labels: [], assignees: [],
      },
      fields: { status: 'Open', difficulty: 'Easy', bounty: '', area: '', ...fields },
    });
    await sync.reconcile(id);
    return { id, thread: (await store.get(id)).threadId };
  }

  const as = (user, roles = [DEV]) => ({
    command: (name, channel) => claims.handleInteraction({
      type: 2, token: `tok-${name}`, channel_id: channel, data: { name }, member: { user: { id: user }, roles },
    }),
    press: (customId) => claims.handleInteraction({
      type: 3, token: 'tok-button', data: { custom_id: customId }, member: { user: { id: user }, roles },
    }),
  });

  return {
    claims, store, items, gh, commits, threads, discordCalls, logs, addGig, as,
    failNextAssign: () => (failNext = true),
  };
}

async function run(result) {
  if (result.followUp) await result.followUp();
  return result.response;
}

test('/claim outside a gig post, or before linking, explains what to do', async () => {
  const t = setup();
  const { thread } = await t.addGig(1);
  assert.match((await run(await t.as('u1').command('claim', 'random'))).data.content, /only works inside gig posts/);
  assert.match((await run(await t.as('u1').command('claim', thread))).data.content, /\/link/);
});

test('request -> maintainer approves -> assigned, Status set, comment, post shows claim', async () => {
  const t = setup();
  const { id, thread } = await t.addGig(1);
  await t.store.saveLink('u1', 'octocat');

  const req = await run(await t.as('u1').command('claim', thread));
  assert.equal(req.type, 4);
  assert.equal(req.data.flags, undefined);
  assert.match(req.data.content, /<@u1> \(GitHub: octocat\) wants this gig\. <@&role-maint>/);
  assert.deepEqual(req.data.allowed_mentions, { parse: [], roles: [MAINT] });
  const approve = req.data.components[0].components[0].custom_id;
  assert.equal(approve, `gig:approve:${id}`);

  assert.match((await run(await t.as('u2').command('claim', thread))).data.content, /already requested/);
  assert.match((await run(await t.as('u2').press(approve))).data.content, /Only maintainers/);

  const res = await t.as('m1', [MAINT]).press(approve);
  assert.equal(res.response.type, 6);
  await res.followUp();
  assert.deepEqual(t.gh.slice(0, 2), [['assign', 1, 'octocat'], ['set', id, 'Status', 'Claimed']]);
  assert.match(t.gh[2][2], /Claimed by @octocat via Discord, approved by a maintainer/);
  const [, token, body] = t.discordCalls.at(-1);
  assert.equal(token, 'tok-button');
  assert.match(body.content, /✅ <@u1> \(GitHub: octocat\) claimed this gig, approved by <@m1>/);
  assert.deepEqual(body.components, []);
  assert.equal((await t.store.get(id)).claim.githubLogin, 'octocat');
  assert.match(t.threads.get(thread), /🔒 Claimed by <@u1> \(GitHub: octocat\)/);
});

test('deny clears the request and updates the message in place', async () => {
  const t = setup();
  const { id, thread } = await t.addGig(1);
  await t.store.saveLink('u1', 'octocat');
  await run(await t.as('u1').command('claim', thread));
  const res = await run(await t.as('m1', [MAINT]).press(`gig:deny:${id}`));
  assert.equal(res.type, 7);
  assert.match(res.data.content, /<@u1>'s request was denied by <@m1>/);
  assert.equal((await t.store.get(id)).pending, null);
  assert.deepEqual(t.gh, []);
});

test('at most 2 active claims or requests per person', async () => {
  const t = setup();
  const gigs = [await t.addGig(1), await t.addGig(2), await t.addGig(3)];
  await t.store.saveLink('u1', 'octocat');
  await run(await t.as('u1').command('claim', gigs[0].thread));
  await run(await t.as('u1').command('claim', gigs[1].thread));
  const third = await run(await t.as('u1').command('claim', gigs[2].thread));
  assert.match(third.data.content, /already have 2 active claims/);
  assert.equal(third.data.flags, 64);
});

test('approval re-checks: a gig assigned on GitHub meanwhile drops the request', async () => {
  const t = setup();
  const { id, thread } = await t.addGig(1);
  await t.store.saveLink('u1', 'octocat');
  await run(await t.as('u1').command('claim', thread));
  t.items.get(id).issue.assignees = ['someone'];
  await run(await t.as('m1', [MAINT]).press(`gig:approve:${id}`));
  assert.match(t.discordCalls.at(-1)[2].content, /no longer open/);
  assert.equal((await t.store.get(id)).pending, null);
  assert.deepEqual(t.gh, []);
});

test('GitHub failure during approval rolls the claim back', async () => {
  const t = setup();
  const { id, thread } = await t.addGig(1);
  await t.store.saveLink('u1', 'octocat');
  await run(await t.as('u1').command('claim', thread));
  t.failNextAssign();
  await run(await t.as('m1', [MAINT]).press(`gig:approve:${id}`));
  assert.match(t.discordCalls.at(-1)[2].content, /Something went wrong/);
  assert.equal((await t.store.get(id)).claim, null);
});

test('outside contributors GitHub cannot assign still get the claim, with a note', async () => {
  const t = setup();
  const { id, thread } = await t.addGig(1);
  await t.store.saveLink('u1', 'outsider');
  await run(await t.as('u1').command('claim', thread));
  await run(await t.as('m1', [MAINT]).press(`gig:approve:${id}`));
  assert.match(t.discordCalls.at(-1)[2].content, /could not assign them yet/);
  assert.match(t.gh.find((c) => c[0] === 'comment')[2], /Leave a comment here/);
  assert.equal((await t.store.get(id)).claim.githubLogin, 'outsider');
});

test('without approval, /claim grants straight away', async () => {
  const t = setup({ approval: false });
  const { id, thread } = await t.addGig(1);
  await t.store.saveLink('u1', 'octocat');
  const res = await t.as('u1').command('claim', thread);
  assert.equal(res.response.type, 5);
  await res.followUp();
  assert.match(t.discordCalls.at(-1)[2].content, /✅ <@u1> \(GitHub: octocat\) claimed this gig\./);
  assert.doesNotMatch(t.gh.find((c) => c[0] === 'comment')[2], /maintainer/);
  assert.ok((await t.store.get(id)).claim);
});

async function claimed(t, n = 1, user = 'u1', login = 'octocat') {
  const gig = await t.addGig(n);
  await t.store.saveLink(user, login);
  await run(await t.as(user).command('claim', gig.thread));
  await run(await t.as('m1', [MAINT]).press(`gig:approve:${gig.id}`));
  t.gh.length = 0;
  return gig;
}

test('/unclaim by the claimant releases it on GitHub too', async () => {
  const t = setup();
  const { id, thread } = await claimed(t);
  await run(await t.as('u1').command('unclaim', thread));
  assert.deepEqual(t.gh.slice(0, 2), [['unassign', 1, 'octocat'], ['set', id, 'Status', 'Open']]);
  assert.match(t.gh[2][2], /@octocat unclaimed this via Discord/);
  assert.match(t.discordCalls.at(-1)[2].content, /<@u1> released this gig/);
  assert.equal((await t.store.get(id)).claim, null);
  assert.doesNotMatch(t.threads.get(thread), /Claimed by/);
});

test('/unclaim by someone else needs the maintainer role', async () => {
  const t = setup();
  const { thread } = await claimed(t);
  assert.match((await run(await t.as('u2').command('unclaim', thread))).data.content, /Only the claimant or a maintainer/);
  await run(await t.as('m1', [MAINT]).command('unclaim', thread));
  assert.match(t.gh.find((c) => c[0] === 'comment')[2], /A maintainer released @octocat's claim/);
});

test('/unclaim withdraws a pending request', async () => {
  const t = setup();
  const { id, thread } = await t.addGig(1);
  await t.store.saveLink('u1', 'octocat');
  await run(await t.as('u1').command('claim', thread));
  const res = await run(await t.as('u1').command('unclaim', thread));
  assert.match(res.data.content, /withdrew their request/);
  assert.equal((await t.store.get(id)).pending, null);
});

test('claims expire 7 days after the last commit, not before', async () => {
  const t = setup();
  const stale = await claimed(t, 1, 'u1', 'octocat');
  const active = await claimed(t, 2, 'u2', 'hubot');
  const review = await claimed(t, 3, 'u3', 'monalisa');
  const now = new Date(Date.now() + 10 * DAY);
  t.commits.set('I_2', new Date(now - 2 * DAY)); // recent commit keeps it
  t.items.get(review.id).fields.status = 'In review';
  await t.store.save({ ...(await t.store.get(review.id)), status: 'In review' });

  assert.deepEqual(await t.claims.expire(now), [stale.id]);
  assert.match(t.gh.find((c) => c[0] === 'comment')[2], /@octocat's claim expired after 7 days without commits/);
  const [, channel, msg] = t.discordCalls.at(-1);
  assert.equal(channel, stale.thread);
  assert.deepEqual(msg.allowed_mentions, { parse: [], users: ['u1'] });
  assert.equal((await t.store.get(active.id)).claim.githubLogin, 'hubot');
  assert.equal((await t.store.get(review.id)).claim.githubLogin, 'monalisa');
  assert.deepEqual(await t.claims.expire(new Date(Date.now() + 6 * DAY)), []);
});

test('/gigs lists open, unclaimed gigs only', async () => {
  const t = setup();
  const open = await t.addGig(1);
  await claimed(t, 2);
  const res = await run(await t.as('u9').command('gigs'));
  assert.equal(res.data.flags, 64);
  assert.match(res.data.content, new RegExp(`<#${open.thread}> \\(o/r#1\\)`));
  assert.doesNotMatch(res.data.content, /o\/r#2/);
});

test('/link gives a sign-in button whose state names the user', async () => {
  const t = setup();
  const res = await run(await t.as('123').command('link'));
  const url = new URL(res.data.components[0].components[0].url);
  assert.equal(url.searchParams.get('redirect_uri'), 'https://bot.test/github/oauth/callback');
  assert.equal(readState('secret', url.searchParams.get('state')), '123');
  assert.match((await run(await setup({ linking: false }).as('1').command('link'))).data.content, /not set up/);
});

test('link callback saves a verified login; bad or expired state is refused', async () => {
  const t = setup();
  const ok = await t.claims.linkCallback({ code: 'good', state: signState('secret', '123') });
  assert.equal(ok.status, 200);
  assert.match(ok.html, /octocat/);
  assert.equal(await t.store.getLink('123'), 'octocat');

  assert.equal((await t.claims.linkCallback({ code: 'good', state: signState('other', '9') })).status, 400);
  const old = signState('secret', '9', Date.now() - 11 * 60 * 1000);
  assert.equal((await t.claims.linkCallback({ code: 'good', state: old })).status, 400);
  assert.equal((await t.claims.linkCallback({ code: 'bad', state: signState('secret', '9') })).status, 502);
  assert.equal(await t.store.getLink('9'), null);
});

test('relinking a GitHub login moves it to the new Discord user', async () => {
  const t = setup();
  await t.store.saveLink('a', 'octocat');
  await t.store.saveLink('b', 'octocat');
  assert.equal(await t.store.getLink('a'), null);
  assert.equal(await t.store.getLink('b'), 'octocat');
});
