import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createApp, ephemeral } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { discordKeys } from './helpers.js';

const keys = discordKeys();
const env = {
  DISCORD_APPLICATION_ID: 'app',
  DISCORD_PUBLIC_KEY: keys.hex,
  DISCORD_BOT_TOKEN: 'token',
  DISCORD_GIG_CHANNEL_ID: 'chan',
  DISCORD_DEVELOPER_ROLE_ID: 'dev',
  GITHUB_WEBHOOK_SECRET: 'hook',
};

async function withServer(overrides, fn) {
  const events = [];
  const app = createApp(loadConfig(env), {
    onGitHubEvent: async (event, payload) => events.push([event, payload.action]),
    ...overrides,
  }, () => {});
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base, events);
  } finally {
    server.close();
  }
}

function githubPost(base, event, payload, secret = 'hook') {
  const body = JSON.stringify(payload);
  const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  return fetch(`${base}/github/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-hub-signature-256': sig },
    body,
  });
}

function discordPost(base, interaction, signFor = keys.signFor) {
  const body = JSON.stringify(interaction);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return fetch(`${base}/discord/interactions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signature-ed25519': signFor(timestamp, Buffer.from(body)),
      'x-signature-timestamp': timestamp,
    },
    body,
  });
}

test('config names missing variables', () => {
  assert.throws(() => loadConfig({}), /DISCORD_BOT_TOKEN/);
});

test('health check', () => withServer({}, async (base) => {
  const res = await fetch(`${base}/health`);
  assert.deepEqual(await res.json(), { ok: true });
}));

test('github webhook: signed events are accepted and dispatched', () => withServer({}, async (base, events) => {
  const res = await githubPost(base, 'projects_v2_item', { action: 'edited' });
  assert.equal(res.status, 202);
  assert.deepEqual(events, [['projects_v2_item', 'edited']]);
}));

test('github webhook: unsigned or wrongly signed events are rejected', () => withServer({}, async (base, events) => {
  assert.equal((await githubPost(base, 'issues', { action: 'closed' }, 'wrong')).status, 401);
  const res = await fetch(`${base}/github/webhook`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(res.status, 401);
  assert.deepEqual(events, []);
}));

test('discord: PING gets PONG', () => withServer({}, async (base) => {
  const res = await discordPost(base, { type: 1 });
  assert.deepEqual(await res.json(), { type: 1 });
}));

test('discord: bad signatures are rejected', () => withServer({}, async (base) => {
  const res = await discordPost(base, { type: 1 }, discordKeys().signFor);
  assert.equal(res.status, 401);
}));

test('discord: commands require the Developer role', () => withServer({
  onCommand: async () => ephemeral('ran'),
}, async (base) => {
  const without = await discordPost(base, { type: 2, data: { name: 'gigs' }, member: { roles: [] } });
  assert.match((await without.json()).data.content, /Developer role/);
  const withRole = await discordPost(base, { type: 2, data: { name: 'gigs' }, member: { roles: ['dev'] } });
  const json = await withRole.json();
  assert.equal(json.data.content, 'ran');
  assert.equal(json.data.flags, 64);
}));
