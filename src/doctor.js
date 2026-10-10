// Checks a deployment's settings against the live GitHub and Discord, so
// setup mistakes show up as a list instead of as silent gaps on the board.
// Read-only: it changes nothing.

const COMMANDS = ['link', 'claim', 'unclaim', 'gigs'];
const GUILD_FORUM = 15;

const lowerSet = (list) => new Set(list.map((v) => v.toLowerCase()));
const missingFrom = (have, want) => {
  const set = lowerSet(have);
  return [...new Set(want)].filter((w) => !set.has(w.toLowerCase()));
};

export async function diagnose({ config, github, discord, guildId, fetchImpl = fetch }) {
  const results = [];
  const ok = (m) => results.push({ level: 'ok', message: m });
  const warn = (m) => results.push({ level: 'warn', message: m });
  const error = (m) => results.push({ level: 'error', message: m });
  async function check(label, fn) {
    try {
      await fn();
    } catch (err) {
      error(`${label}: ${err.message}`);
    }
  }

  const s = config.board;
  const boards = config.boards;
  ok(`Config loaded: boards ${boards.map((b) => `${b.name} (${b.channelId})`).join(', ')}`);
  const c = s.claims;
  ok(`Claims: ${c.requireApproval ? 'maintainer approval' : 'first come, first served'}, max ${c.maxActivePerUser} each, `
    + (c.expireDaysAfterLastCommit ? `expire after ${c.expireDaysAfterLastCommit} days without commits` : 'never expire'));
  if (!github.linkingEnabled || !config.publicUrl) {
    warn('/link is off (needs GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and PUBLIC_URL), so nobody can claim gigs');
  }

  // ---- Public URL ----
  if (config.publicUrl) {
    await check('PUBLIC_URL', async () => {
      const res = await fetchImpl(`${config.publicUrl}/health`);
      if (res.ok) ok(`${config.publicUrl}/health responds`);
      else error(`${config.publicUrl}/health returned ${res.status}`);
    });
  }

  // ---- GitHub App ----
  await check('GitHub App installation', async () => {
    const inst = await github.appGet(`/app/installations/${config.github.installationId}`);
    ok(`GitHub App installed on ${inst.account?.login}`);
    const perms = inst.permissions || {};
    if (perms.issues !== 'write') error('GitHub App needs Issues: Read and write (accept new permissions under the org\'s installed apps)');
    if (perms.organization_projects !== 'write') error('GitHub App needs organization Projects: Read and write');
    const events = missingFrom(inst.events || [], ['issues', 'projects_v2_item']);
    if (events.length) error(`GitHub App is not subscribed to: ${events.join(', ')}`);
  });
  await check('GitHub App webhook', async () => {
    const hook = await github.appGet('/app/hook/config');
    const want = config.publicUrl && `${config.publicUrl}/github/webhook`;
    if (want && hook.url !== want) error(`GitHub App webhook URL is ${hook.url || '(none)'}, expected ${want}`);
    else if (hook.url) ok(`GitHub App webhook → ${hook.url}`);
    if (hook.content_type !== 'json') error('GitHub App webhook content type must be application/json');
  });

  // ---- Project fields ----
  let difficultyOptions = [];
  await check('GitHub Project', async () => {
    const project = await github.projectFields(config.github.projectId);
    if (!project) {
      error('Cannot read GITHUB_PROJECT_ID. Check the id (PVT_…) and that the App is installed on the org that owns it.');
      return;
    }
    ok(`Project "${project.title}" readable`);
    const byName = new Map(project.fields.map((f) => [f.name.toLowerCase(), f]));
    const field = (key) => byName.get(s.fields[key].toLowerCase());

    const status = field('status');
    if (!status?.options) {
      error(`Project has no single-select field "${s.fields.status}"`);
    } else {
      const need = missingFrom(status.options, [s.statuses.open, s.statuses.claimed]);
      if (need.length) error(`${s.fields.status} is missing option(s) the bot sets: ${need.join(', ')}`);
      const posted = missingFrom(status.options, s.postStatuses);
      if (posted.length) warn(`postStatuses not in ${s.fields.status}: ${posted.join(', ')}`);
    }
    for (const key of ['difficulty', 'area']) {
      if (!field(key)) warn(`No "${s.fields[key]}" field; posts fall back to labels for it`);
    }
    if (!field('bounty')) warn(`No "${s.fields.bounty}" field; posts show no bounty`);
    difficultyOptions = field('difficulty')?.options || [];

    const typed = boards.filter((b) => b.types.size);
    if (typed.length) {
      const type = field('type');
      if (!type?.options) {
        warn(`Boards route by "${s.fields.type}", but the Project has no such field; only labels will route`);
      } else {
        const unknown = missingFrom(type.options, typed.flatMap((b) => [...b.types]));
        if (unknown.length) warn(`Board types not in ${s.fields.type}: ${unknown.join(', ')}`);
      }
    }
  });

  // ---- Discord application ----
  await check('Discord application', async () => {
    const app = await discord.request('GET', '/applications/@me');
    ok(`Discord application "${app.name}"`);
    const want = config.publicUrl && `${config.publicUrl}/discord/interactions`;
    if (want && app.interactions_endpoint_url !== want) {
      error(`Interactions Endpoint URL is ${app.interactions_endpoint_url || '(none)'}, expected ${want}`);
    }
    if (app.bot_public) warn('"Public Bot" is on, so anyone can add this bot to their server. Turn it off under Bot.');
  });
  await check('Slash commands', async () => {
    const appId = config.discord.applicationId;
    const path = guildId ? `/applications/${appId}/guilds/${guildId}/commands` : `/applications/${appId}/commands`;
    const missing = missingFrom((await discord.request('GET', path)).map((c) => c.name), COMMANDS);
    if (missing.length) error(`Slash commands not registered: /${missing.join(' /')} (run npm run register-commands)`);
    else ok('Slash commands registered');
  });
  if (guildId) {
    await check('Roles', async () => {
      const ids = new Set((await discord.request('GET', `/guilds/${guildId}/roles`)).map((r) => r.id));
      for (const [name, id] of [['Developer', config.discord.developerRoleId], ['Maintainer', config.discord.maintainerRoleId]]) {
        if (!id) warn(`No ${name} role set`);
        else if (!ids.has(id)) error(`${name} role ${id} not found in the server`);
      }
    });
  }

  // ---- Forums ----
  const tagsWanted = [
    s.claimedTag,
    ...difficultyOptions,
    ...Object.values(s.areaTags),
    ...Object.values(s.labelTags),
  ];
  for (const board of boards) {
    await check(`${board.name} forum`, async () => {
      const channel = await discord.request('GET', `/channels/${board.channelId}`);
      if (channel.type !== GUILD_FORUM) {
        error(`${board.name} (${board.channelId}) is not a forum channel`);
        return;
      }
      const missing = missingFrom((channel.available_tags || []).map((t) => t.name), tagsWanted);
      if (missing.length) warn(`#${channel.name} has no tag(s): ${missing.join(', ')} (only needed if gigs there use them)`);
      else ok(`#${channel.name} has every tag`);
    });
  }

  return results;
}
