import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { createDiscordClient } from '../src/discord.js';
import { appJwt, createGitHubClient, normalizePrivateKey } from '../src/github.js';

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, ...init, body: init.body && JSON.parse(init.body) });
    const [status, body] = responses.shift();
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  };
  return { fn, calls };
}

test('discord: retries after a 429', async () => {
  const f = fakeFetch([[429, { retry_after: 0.01 }], [200, { id: '55' }]]);
  const waits = [];
  const discord = createDiscordClient({ botToken: 'tok' }, f.fn, async (ms) => waits.push(ms));
  assert.equal(await discord.createPost('forum', { name: 'x' }), '55');
  assert.deepEqual(waits, [10]);
  assert.equal(f.calls[1].headers.Authorization, 'Bot tok');
});

test('discord: deleting a post that is already gone is fine', async () => {
  const f = fakeFetch([[404, { message: 'Unknown Channel' }]]);
  await createDiscordClient({ botToken: 't' }, f.fn).deletePost('9');
  assert.equal(f.calls[0].method, 'DELETE');
});

test('discord: other errors are thrown', async () => {
  const f = fakeFetch([[403, { message: 'Missing Permissions' }]]);
  await assert.rejects(createDiscordClient({ botToken: 't' }, f.fn).deletePost('9'), /403/);
});

test('discord: updates unarchive the thread, then edit the starter message', async () => {
  const f = fakeFetch([[200, {}], [200, {}]]);
  await createDiscordClient({ botToken: 't' }, f.fn).updatePost('7', {
    thread: { name: 'n', applied_tags: [] },
    message: { content: 'c' },
  });
  assert.match(f.calls[0].url, /\/channels\/7$/);
  assert.equal(f.calls[0].body.archived, false);
  assert.match(f.calls[1].url, /\/channels\/7\/messages\/7$/);
});

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });

test('github: app JWT is RS256-signed with the app id as issuer', () => {
  const jwt = appJwt(123, pem, 1_700_000_000_000);
  const [h, p, sig] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).iss, '123');
  assert.ok(verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(sig, 'base64url')));
});

test('github: private keys with literal \\n are fixed', () => {
  assert.equal(normalizePrivateKey('a\\nb'), 'a\nb');
});

test('github: getItem flattens the item and reuses the installation token', async () => {
  const later = new Date(Date.now() + 3600_000).toISOString();
  const node = {
    id: 'PVTI_1',
    isArchived: false,
    project: { id: 'PVT_1' },
    content: {
      __typename: 'Issue', id: 'I_1', number: 78, title: 'T', body: 'B', url: 'u', state: 'OPEN',
      repository: { nameWithOwner: 'o/r' }, labels: { nodes: [{ name: 'backend' }] },
    },
    status: { name: 'Open' }, difficulty: { name: 'Easy' }, bounty: { text: '$5' }, area: null,
  };
  const f = fakeFetch([
    [201, { token: 'inst', expires_at: later }],
    [200, { data: { node } }],
    [200, { data: { node: null }, errors: [{ type: 'NOT_FOUND', message: 'gone' }] }],
  ]);
  const gh = createGitHubClient({ appId: 1, privateKey: pem, installationId: 9 }, f.fn);
  const fields = { status: 'Status', difficulty: 'Difficulty', bounty: 'Bounty', area: 'Area' };
  assert.deepEqual(await gh.getItem('PVTI_1', fields), {
    id: 'PVTI_1', projectId: 'PVT_1', isArchived: false,
    issue: { id: 'I_1', repo: 'o/r', number: 78, title: 'T', body: 'B', url: 'u', state: 'OPEN', labels: ['backend'] },
    fields: { status: 'Open', difficulty: 'Easy', bounty: '$5', area: '' },
  });
  assert.equal(await gh.getItem('PVTI_gone', fields), null);
  assert.equal(f.calls.filter((c) => c.url.endsWith('/access_tokens')).length, 1);
  assert.equal(f.calls[1].headers.Authorization, 'Bearer inst');
});

test('github: real GraphQL errors are thrown', async () => {
  const later = new Date(Date.now() + 3600_000).toISOString();
  const f = fakeFetch([
    [201, { token: 'inst', expires_at: later }],
    [200, { errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible' }] }],
  ]);
  const gh = createGitHubClient({ appId: 1, privateKey: pem, installationId: 9 }, f.fn);
  await assert.rejects(gh.listItems('PVT_1'), /Resource not accessible/);
});
