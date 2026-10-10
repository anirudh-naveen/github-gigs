import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from '../src/doctor.js';
import { loadConfig } from '../src/config.js';

const env = {
  GIGS_CONFIG: 'config/anilounge.json',
  DISCORD_APPLICATION_ID: 'app',
  DISCORD_PUBLIC_KEY: '0'.repeat(64),
  DISCORD_BOT_TOKEN: 't',
  DISCORD_GIG_CHANNEL_ID: 'code',
  DISCORD_CONTENT_CHANNEL_ID: 'content',
  DISCORD_ART_CHANNEL_ID: 'art',
  DISCORD_DEVELOPER_ROLE_ID: 'dev',
  DISCORD_MAINTAINER_ROLE_ID: 'maint',
  GITHUB_WEBHOOK_SECRET: 's',
  GITHUB_APP_ID: '1',
  GITHUB_APP_PRIVATE_KEY: 'k',
  GITHUB_INSTALLATION_ID: '9',
  GITHUB_PROJECT_ID: 'PVT_1',
  GITHUB_CLIENT_ID: 'cid',
  GITHUB_CLIENT_SECRET: 'csec',
  PUBLIC_URL: 'https://bot.test',
  DATABASE_URL: 'postgres://x',
};

const ALL_TAGS = ['Claimed', 'Easy', 'Medium', 'Hard', 'Frontend', 'Backend', 'Security', 'Mobile', 'Feature', 'Bug Fix'];

function world(over = {}) {
  const w = {
    installation: {
      account: { login: 'anilounge' },
      permissions: { issues: 'write', organization_projects: 'write', metadata: 'read' },
      events: ['issues', 'projects_v2_item'],
    },
    hook: { url: 'https://bot.test/github/webhook', content_type: 'json' },
    project: {
      title: 'AniLounge Gigs',
      fields: [
        { name: 'Status', options: ['Open', 'Claimed', 'In review', 'Done'] },
        { name: 'Type', options: ['Code', 'Content', 'Art'] },
        { name: 'Difficulty', options: ['Easy', 'Medium', 'Hard'] },
        { name: 'Area', options: ['Frontend', 'Backend', 'Security', 'Mobile'] },
        { name: 'Bounty', dataType: 'TEXT' },
      ],
    },
    app: { name: 'AniLounge Gigs', interactions_endpoint_url: 'https://bot.test/discord/interactions', bot_public: false },
    commands: ['link', 'claim', 'unclaim', 'gigs'],
    roles: ['dev', 'maint', 'everyone'],
    channels: {
      code: { name: 'code-gigs', type: 15, tags: ALL_TAGS },
      content: { name: 'content-gigs', type: 15, tags: ALL_TAGS },
      art: { name: 'art-gigs', type: 15, tags: ALL_TAGS },
    },
    health: 200,
    ...over,
  };
  const github = {
    linkingEnabled: true,
    async appGet(path) {
      return path === '/app/hook/config' ? w.hook : w.installation;
    },
    async projectFields() {
      return w.project;
    },
  };
  const discord = {
    async request(method, path) {
      if (path === '/applications/@me') return w.app;
      if (path.endsWith('/commands')) return w.commands.map((name) => ({ name }));
      if (path.endsWith('/roles')) return w.roles.map((id) => ({ id }));
      const ch = w.channels[path.split('/').pop()];
      return { name: ch.name, type: ch.type, available_tags: ch.tags.map((name) => ({ name })) };
    },
  };
  const fetchImpl = async () => new Response('{}', { status: w.health });
  return { github, discord, fetchImpl };
}

async function run(over, envOver = {}) {
  const config = loadConfig({ ...env, ...envOver });
  const results = await diagnose({ config, ...world(over), guildId: 'g' });
  return {
    errors: results.filter((r) => r.level === 'error').map((r) => r.message),
    warnings: results.filter((r) => r.level === 'warn').map((r) => r.message),
  };
}

test('a correct setup has no errors or warnings', async () => {
  assert.deepEqual(await run(), { errors: [], warnings: [] });
});

test('catches GitHub App mistakes', async () => {
  const { errors } = await run({
    installation: { account: { login: 'x' }, permissions: { issues: 'read' }, events: ['issues'] },
    hook: { url: 'https://old.test/hook', content_type: 'form' },
  });
  assert.equal(errors.length, 5);
  assert.match(errors.join('\n'), /Issues: Read and write/);
  assert.match(errors.join('\n'), /organization Projects/);
  assert.match(errors.join('\n'), /not subscribed to: projects_v2_item/);
  assert.match(errors.join('\n'), /expected https:\/\/bot\.test\/github\/webhook/);
  assert.match(errors.join('\n'), /application\/json/);
});

test('catches Project field mistakes', async () => {
  const { errors, warnings } = await run({
    project: { title: 'P', fields: [{ name: 'Status', options: ['Todo', 'Open', 'Done'] }] },
  });
  assert.deepEqual(errors, ['Status is missing option(s) the bot sets: Claimed']);
  assert.match(warnings.join('\n'), /postStatuses not in Status: Claimed, In review/);
  assert.match(warnings.join('\n'), /no such field; only labels will route/);
  assert.match(warnings.join('\n'), /posts show no bounty/);
});

test('an unreadable Project is an error', async () => {
  const { errors } = await run({ project: null });
  assert.match(errors[0], /Cannot read GITHUB_PROJECT_ID/);
});

test('catches Discord mistakes', async () => {
  const { errors, warnings } = await run({
    app: { name: 'A', interactions_endpoint_url: null, bot_public: true },
    commands: ['link'],
    roles: ['dev'],
    channels: {
      code: { name: 'code-gigs', type: 15, tags: ['Claimed'] },
      content: { name: 'general', type: 0, tags: [] },
      art: { name: 'art-gigs', type: 15, tags: ALL_TAGS },
    },
    health: 502,
  });
  assert.match(errors.join('\n'), /health returned 502/);
  assert.match(errors.join('\n'), /Interactions Endpoint URL is \(none\)/);
  assert.match(errors.join('\n'), /not registered: \/claim \/unclaim \/gigs/);
  assert.match(errors.join('\n'), /Maintainer role maint not found/);
  assert.match(errors.join('\n'), /Content \(content\) is not a forum channel/);
  assert.match(warnings.join('\n'), /Public Bot/);
  assert.match(warnings.join('\n'), /#code-gigs has no tag\(s\): Easy, Medium/);
});

test('one failing API call is reported, the rest still run', async () => {
  const w = world();
  w.discord.request = async () => {
    throw new Error('Discord GET failed: 401');
  };
  const results = await diagnose({ config: loadConfig(env), ...w, guildId: 'g' });
  const errors = results.filter((r) => r.level === 'error');
  assert.ok(errors.every((e) => /401/.test(e.message)));
  assert.ok(results.some((r) => /Project "AniLounge Gigs" readable/.test(r.message)));
});

test('linking off is a warning', async () => {
  const { warnings } = await run({}, { GITHUB_CLIENT_ID: '', PUBLIC_URL: '' });
  assert.match(warnings.join('\n'), /\/link is off/);
});
