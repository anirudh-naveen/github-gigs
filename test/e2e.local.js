// End-to-end run of the real server and backfill script against a real
// Postgres, with stand-in GitHub and Discord APIs on localhost.
//   DATABASE_URL=postgres://... npm run test:e2e
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import pg from 'pg';
import { loadConfig } from '../src/config.js';
import { createRuntime } from '../src/runtime.js';
import { discordKeys } from './helpers.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('Set DATABASE_URL to a throwaway Postgres database');

const PROJECT = 'PVT_e2e';
const SECRET = 'e2e-webhook-secret';
const PORT = 3998;
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keys = discordKeys();
const OPTIONS = [{ id: 'O_open', name: 'Open' }, { id: 'O_claimed', name: 'Claimed' }, { id: 'O_done', name: 'Done' }];
const comments = [];

// ---- Stand-in GitHub: an in-memory Project ----------------------------------
const items = new Map();
function issueItem(id, number, over = {}) {
  return {
    id,
    isArchived: false,
    project: { id: PROJECT },
    content: {
      __typename: 'Issue',
      id: `I_${id}`,
      number,
      title: `Gig ${number}`,
      body: `Do thing ${number}.\n\n**Requirements**\n- Step one\n- Step two`,
      url: `https://github.com/anilounge/anilounge/issues/${number}`,
      state: 'OPEN',
      repository: { nameWithOwner: 'anilounge/anilounge' },
      labels: { nodes: [{ name: 'frontend' }] },
      assignees: { nodes: [] },
      ...over.content,
    },
    status: { name: 'Open' },
    difficulty: { name: 'Easy' },
    bounty: null,
    area: { name: 'Frontend' },
    ...over.fields,
  };
}

const github = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const send = (status, json) => {
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(json));
  };
  if (req.url.endsWith('/access_tokens')) {
    assert.match(req.headers.authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    return send(201, { token: 'inst-token', expires_at: new Date(Date.now() + 3600e3).toISOString() });
  }
  // GitHub sign-in for /link.
  if (req.url === '/login/oauth/access_token') {
    const { client_id, client_secret, code } = JSON.parse(body);
    assert.deepEqual([client_id, client_secret], ['e2e-client', 'e2e-client-secret']);
    return send(200, code === 'good-code' ? { access_token: 'user-token' } : { error: 'bad_verification_code' });
  }
  if (req.url === '/user') {
    assert.equal(req.headers.authorization, 'Bearer user-token');
    return send(200, { login: 'octocat' });
  }
  assert.equal(req.headers.authorization, 'Bearer inst-token');

  const issue = req.url.match(/^\/repos\/anilounge\/anilounge\/issues\/(\d+)\/(assignees|comments)$/);
  if (issue) {
    const item = [...items.values()].find((i) => i.content.number === Number(issue[1]));
    const json = JSON.parse(body);
    if (issue[2] === 'comments') {
      comments.push([Number(issue[1]), json.body]);
      return send(201, { id: comments.length });
    }
    const current = item.content.assignees.nodes.map((n) => n.login);
    const next = req.method === 'POST'
      ? [...new Set([...current, ...json.assignees])]
      : current.filter((l) => !json.assignees.includes(l));
    item.content.assignees.nodes = next.map((login) => ({ login }));
    return send(req.method === 'POST' ? 201 : 200, { assignees: next.map((login) => ({ login })) });
  }

  const { query, variables } = JSON.parse(body);
  if (query.includes('updateProjectV2ItemFieldValue')) {
    assert.equal(variables.field, 'F_status');
    items.get(variables.item).status = { name: OPTIONS.find((o) => o.id === variables.option).name };
    return send(200, { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: variables.item } } } });
  }
  if (query.includes('field(name')) {
    return send(200, { data: { node: { field: { id: 'F_status', options: OPTIONS } } } });
  }
  if (query.includes('closedByPullRequestsReferences')) {
    return send(200, { data: { node: { closedByPullRequestsReferences: { nodes: [] } } } });
  }
  if (query.includes('fieldValueByName')) {
    const node = items.get(variables.id) ?? null;
    return send(200, node ? { data: { node } } : { data: { node: null }, errors: [{ type: 'NOT_FOUND', message: 'gone' }] });
  }
  if (query.includes('projectItems')) {
    const nodes = [...items.values()]
      .filter((i) => i.content?.id === variables.id)
      .map((i) => ({ id: i.id, project: { id: PROJECT } }));
    return send(200, { data: { node: { projectItems: { nodes } } } });
  }
  if (query.includes('items(first')) {
    const nodes = [...items.keys()].map((id) => ({ id }));
    return send(200, { data: { node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } });
  }
  send(400, { message: 'unexpected query' });
});

// ---- Stand-in Discord: a forum channel --------------------------------------
const threads = new Map();
const log = [];
let nextId = 9000;
let rateLimitOnce = true;
const TAGS = [
  { id: 'tag-frontend', name: 'Frontend' },
  { id: 'tag-easy', name: 'Easy' },
  { id: 'tag-hard', name: 'Hard' },
  { id: 'tag-claimed', name: 'Claimed' },
];
const edits = [];
const sent = [];

const discord = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const json = body ? JSON.parse(body) : undefined;
  const send = (status, out) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(out === undefined ? '' : JSON.stringify(out));
  };
  assert.equal(req.headers.authorization, 'Bot e2e-bot-token');
  const path = req.url;
  log.push(`${req.method} ${path}`);

  if (req.method === 'GET' && path === '/channels/forum') return send(200, { id: 'forum', available_tags: TAGS });
  if (req.method === 'POST' && path === '/channels/forum/threads') {
    if (rateLimitOnce) {
      rateLimitOnce = false;
      return send(429, { retry_after: 0.05 });
    }
    assert.deepEqual(json.message.allowed_mentions, { parse: [] });
    assert.ok(json.name.length <= 100 && json.message.content.length <= 2000);
    const id = String(nextId++);
    threads.set(id, { name: json.name, tags: json.applied_tags, content: json.message.content, archived: false });
    return send(201, { id });
  }
  let m = path.match(/^\/channels\/(\d+)$/);
  if (m && req.method === 'PATCH') {
    const t = threads.get(m[1]);
    if (!t) return send(404, { message: 'Unknown Channel', code: 10003 });
    Object.assign(t, { name: json.name, tags: json.applied_tags, archived: json.archived });
    return send(200, { id: m[1] });
  }
  if (m && req.method === 'DELETE') {
    if (!threads.delete(m[1])) return send(404, { message: 'Unknown Channel', code: 10003 });
    return send(200, { id: m[1] });
  }
  m = path.match(/^\/webhooks\/e2e\/([\w-]+)\/messages\/@original$/);
  if (m && req.method === 'PATCH') {
    edits.push([m[1], json]);
    return send(200, { id: 'm' });
  }
  m = path.match(/^\/channels\/(\d+)\/messages$/);
  if (m && req.method === 'POST') {
    sent.push([m[1], json]);
    return send(200, { id: 'm' });
  }
  m = path.match(/^\/channels\/(\d+)\/messages\/(\d+)$/);
  if (m && req.method === 'PATCH') {
    const t = threads.get(m[1]);
    if (!t) return send(404, { message: 'Unknown Channel' });
    if (t.archived) return send(400, { message: 'Thread is archived', code: 50083 });
    assert.deepEqual(json.allowed_mentions, { parse: [] });
    t.content = json.content;
    return send(200, { id: m[2] });
  }
  send(404, { message: `unhandled ${req.method} ${path}` });
});

// ---- Helpers ----------------------------------------------------------------
const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const githubPort = await listen(github);
const discordPort = await listen(discord);

const env = {
  ...process.env,
  PORT: String(PORT),
  DATABASE_URL,
  GIGS_CONFIG: 'config/anilounge.json',
  DISCORD_APPLICATION_ID: 'e2e',
  DISCORD_PUBLIC_KEY: keys.hex,
  DISCORD_DEVELOPER_ROLE_ID: 'dev',
  DISCORD_MAINTAINER_ROLE_ID: 'maint',
  DISCORD_BOT_TOKEN: 'e2e-bot-token',
  DISCORD_GIG_CHANNEL_ID: 'forum',
  DISCORD_API_URL: `http://127.0.0.1:${discordPort}`,
  GITHUB_APP_ID: '1',
  // As Railway would store it: one line with literal \n.
  GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs1', format: 'pem' }).replace(/\n/g, '\\n'),
  GITHUB_INSTALLATION_ID: '42',
  GITHUB_PROJECT_ID: PROJECT,
  GITHUB_WEBHOOK_SECRET: SECRET,
  GITHUB_API_URL: `http://127.0.0.1:${githubPort}`,
  GITHUB_WEB_URL: `http://127.0.0.1:${githubPort}`,
  GITHUB_CLIENT_ID: 'e2e-client',
  GITHUB_CLIENT_SECRET: 'e2e-client-secret',
  PUBLIC_URL: `http://127.0.0.1:${PORT}`,
};

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`${script} exited ${code}:\n${out}`))));
  });
}

async function webhook(event, payload, secret = SECRET) {
  const body = JSON.stringify(payload);
  return fetch(`http://127.0.0.1:${PORT}/github/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-hub-signature-256': 'sha256=' + createHmac('sha256', secret).update(body).digest('hex'),
    },
    body,
  });
}

async function interact(interaction) {
  const body = JSON.stringify(interaction);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const res = await fetch(`http://127.0.0.1:${PORT}/discord/interactions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signature-ed25519': keys.signFor(timestamp, Buffer.from(body)),
      'x-signature-timestamp': timestamp,
    },
    body,
  });
  assert.equal(res.status, 200);
  return res.json();
}

const itemEvent = (action, id) =>
  webhook('projects_v2_item', { action, projects_v2_item: { node_id: id, project_node_id: PROJECT } });

async function until(what, check, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for: ${what}`);
}

const db = new pg.Pool({ connectionString: DATABASE_URL });
await db.query('DROP TABLE IF EXISTS gigs, links');
const dbRows = async () => (await db.query('SELECT project_item_id, thread_id FROM gigs ORDER BY 1')).rows;
const only = () => [...threads.values()][0];
const steps = [];
const step = (name) => steps.push(name) && console.log(`- ${name}`);

// ---- Scenario ---------------------------------------------------------------
let server;
let serverOut = '';
async function startServer() {
  server = spawn(process.execPath, ['src/server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => (serverOut += d));
  server.stderr.on('data', (d) => (serverOut += d));
  await until('server up', async () => (await fetch(`http://127.0.0.1:${PORT}/health`).catch(() => null))?.ok);
}
const exited = () => new Promise((r) => (server.exitCode === null ? server.once('exit', r) : r()));

try {
  await startServer();
  step('server started and created the gigs table');

  assert.equal((await webhook('issues', { action: 'edited' }, 'wrong-secret')).status, 401);
  step('webhook with a bad signature is rejected');

  items.set('PVTI_1', issueItem('PVTI_1', 72));
  assert.equal((await itemEvent('created', 'PVTI_1')).status, 202);
  await until('post created', () => threads.size === 1);
  assert.equal(only().name, '#72 Gig 72');
  assert.deepEqual(only().tags, ['tag-frontend', 'tag-easy']);
  assert.match(only().content, /\*\*Difficulty\*\*: Easy[\s\S]*- Step two[\s\S]*\/claim/);
  await until('row stored', async () => (await dbRows()).length === 1);
  step('Open item -> post created (after a 429 retry), thread id stored in Postgres');

  items.get('PVTI_1').difficulty = { name: 'Hard' };
  items.get('PVTI_1').bounty = { text: '$40' };
  only().archived = true;
  await itemEvent('edited', 'PVTI_1');
  await until('post updated', () => only().content.includes('$40'));
  assert.deepEqual(only().tags, ['tag-frontend', 'tag-hard']);
  assert.equal(threads.size, 1);
  step('field edit -> same post updated, archived thread reopened first');

  items.get('PVTI_1').content.title = 'Gig 72, renamed';
  await webhook('issues', { action: 'edited', issue: { node_id: 'I_PVTI_1' } });
  await until('title updated', () => only().name === '#72 Gig 72, renamed');
  step('issue edit -> post title updated');

  items.get('PVTI_1').content.state = 'CLOSED';
  await webhook('issues', { action: 'closed', issue: { node_id: 'I_PVTI_1' } });
  await until('post deleted', () => threads.size === 0);
  assert.deepEqual(await dbRows(), []);
  step('issue closed -> post deleted, row removed');

  items.get('PVTI_1').content.state = 'OPEN';
  await webhook('issues', { action: 'reopened', issue: { node_id: 'I_PVTI_1' } });
  await until('reposted', () => threads.size === 1);
  step('issue reopened -> posted again');

  items.set('PVTI_2', issueItem('PVTI_2', 99, { content: { labels: { nodes: [{ name: 'security' }] } } }));
  await itemEvent('created', 'PVTI_2');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(threads.size, 1);
  step('security gig -> never posted');

  await Promise.all([1, 2, 3].map(() => itemEvent('edited', 'PVTI_1')));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(threads.size, 1);
  step('burst of events -> still exactly one post');

  // While the "bot is down": one item removed, one added, one post deleted by hand.
  server.kill();
  await exited();
  const removedThread = [...threads.keys()][0];
  items.delete('PVTI_1');
  items.set('PVTI_3', issueItem('PVTI_3', 80));
  items.set('PVTI_4', issueItem('PVTI_4', 81, { fields: { status: { name: 'Done' } } }));
  const out = await run('scripts/backfill.js');
  assert.match(out, /"created":1/);
  assert.match(out, /"deleted":1/);
  assert.ok(!threads.has(removedThread));
  assert.deepEqual([...threads.values()].map((t) => t.name), ['#80 Gig 80']);
  assert.deepEqual((await dbRows()).map((r) => r.project_item_id), ['PVTI_3']);
  step('backfill -> removed item deleted, new item posted, Done item skipped');

  threads.clear();
  await run('scripts/backfill.js');
  assert.equal(threads.size, 1);
  step('post deleted by hand -> backfill reposts it');

  // ---- Claims ----
  await startServer();
  const thread = [...threads.keys()][0];
  const as = (user, roles = ['dev']) => ({
    command: (name) => interact({
      type: 2, token: `tok-${name}-${steps.length}`, channel_id: thread, data: { name },
      member: { user: { id: user }, roles },
    }),
    press: (custom_id) => interact({
      type: 3, token: `tok-press-${steps.length}`, data: { custom_id }, member: { user: { id: user }, roles },
    }),
  });
  const lastEdit = () => edits.at(-1)?.[1].content || '';
  const gigRow = async () => (await db.query('SELECT * FROM gigs WHERE project_item_id = $1', ['PVTI_3'])).rows[0];
  const gig = items.get('PVTI_3');

  assert.match((await as('1001', []).command('claim')).data.content, /Developer role/);
  assert.match((await as('1001').command('claim')).data.content, /\/link/);
  step('/claim needs the Developer role, then a linked GitHub account');

  const link = await as('1001').command('link');
  const url = new URL(link.data.components[0].components[0].url);
  assert.equal(url.searchParams.get('client_id'), 'e2e-client');
  const callback = new URL(url.searchParams.get('redirect_uri'));
  callback.search = new URLSearchParams({ code: 'good-code', state: url.searchParams.get('state') });
  const page = await fetch(callback);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /octocat/);
  callback.search = new URLSearchParams({ code: 'good-code', state: 'forged.1.2' });
  assert.equal((await fetch(callback)).status, 400);
  assert.deepEqual((await db.query('SELECT discord_id, github_login FROM links')).rows, [{ discord_id: '1001', github_login: 'octocat' }]);
  step('/link -> GitHub sign-in callback stores the verified login; forged state refused');

  const request = await as('1001').command('claim');
  assert.match(request.data.content, /<@1001> \(GitHub: octocat\) wants this gig\. <@&maint>/);
  const approveId = request.data.components[0].components[0].custom_id;
  assert.equal((await gigRow()).pending_discord_id, '1001');
  assert.match((await as('1002').command('claim')).data.content, /already requested/);
  assert.match((await as('1001').press(approveId)).data.content, /Only maintainers/);
  step('/claim -> public request with Approve/Deny; others blocked; only maintainers decide');

  assert.equal((await as('2001', ['maint']).press(approveId)).type, 6);
  await until('approval edit', () => lastEdit().startsWith('✅'));
  assert.match(lastEdit(), /<@1001> \(GitHub: octocat\) claimed this gig, approved by <@2001>/);
  assert.equal(gig.status.name, 'Claimed');
  assert.deepEqual(gig.content.assignees.nodes, [{ login: 'octocat' }]);
  assert.match(comments.at(-1)[1], /Claimed by @octocat via Discord/);
  assert.match(threads.get(thread).content, /🔒 Claimed by <@1001> \(GitHub: octocat\)/);
  assert.deepEqual(threads.get(thread).tags.slice(0, 1), ['tag-claimed']);
  assert.equal((await gigRow()).claimed_by_github, 'octocat');
  step('approve -> assigned, Status = Claimed, issue comment, post shows claim + tag');

  assert.match((await as('1009').command('gigs')).data.content, /No open gigs/);
  assert.match((await as('1002').command('unclaim')).data.content, /Only the claimant or a maintainer/);
  assert.equal((await as('1001').command('unclaim')).type, 5);
  await until('unclaim edit', () => /released this gig/.test(lastEdit()));
  assert.equal(gig.status.name, 'Open');
  assert.deepEqual(gig.content.assignees.nodes, []);
  assert.equal((await gigRow()).claimed_by_discord_id, null);
  assert.doesNotMatch(threads.get(thread).content, /Claimed by/);
  assert.match((await as('1009').command('gigs')).data.content, new RegExp(`<#${thread}>`));
  step('/unclaim -> unassigned, Status = Open, post reopened, back in /gigs');

  await as('1001').command('claim');
  await as('2001', ['maint']).press(approveId);
  await until('claimed again', async () => (await gigRow()).claimed_by_github === 'octocat');
  const runtime = await createRuntime(loadConfig(env), () => {});
  try {
    assert.deepEqual(await runtime.claims.expire(new Date(Date.now() + 6 * 86400e3)), []);
    assert.deepEqual(await runtime.claims.expire(new Date(Date.now() + 8 * 86400e3)), ['PVTI_3']);
  } finally {
    await runtime.close();
  }
  assert.equal(gig.status.name, 'Open');
  assert.match(comments.at(-1)[1], /claim expired after 7 days without commits/);
  assert.deepEqual(sent.at(-1), [thread, {
    content: "<@1001>'s claim expired after 7 days without commits. This gig is open again.",
    allowed_mentions: { parse: [], users: ['1001'] },
  }]);
  step('expiry -> kept at 6 days, released at 8 days with a ping in the thread');

  console.log(`\nall ${steps.length} steps passed`);
} catch (err) {
  console.error(`\nFAILED: ${err.message}\n--- server output ---\n${serverOut}\n--- discord calls ---\n${log.join('\n')}`);
  process.exitCode = 1;
} finally {
  server.kill();
  await db.end();
  github.close();
  discord.close();
}
