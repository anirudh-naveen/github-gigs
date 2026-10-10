import pg from 'pg';
import { createClaims } from './claims.js';
import { createDiscordClient } from './discord.js';
import { createGitHubClient } from './github.js';
import { createPgStore } from './store.js';
import { createSync } from './sync.js';

// Builds the real clients from config. Shared by the server and scripts.
export async function createRuntime(config, log = console.log) {
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const store = createPgStore(pool);
  await store.init();
  const github = createGitHubClient(config.github);
  const discord = createDiscordClient(config.discord);
  const sync = createSync({
    github,
    discord,
    store,
    settings: config.board,
    channelId: config.discord.gigChannelId,
    projectId: config.github.projectId,
    log,
  });
  const claims = createClaims({ github, discord, store, sync, settings: config.board, config, log });
  return { sync, claims, discord, close: () => pool.end() };
}
