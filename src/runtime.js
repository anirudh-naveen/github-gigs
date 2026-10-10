import pg from 'pg';
import { createDiscordClient } from './discord.js';
import { createGitHubClient } from './github.js';
import { createPgStore } from './store.js';
import { createSync } from './sync.js';

// Builds the real clients from config. Shared by the server and scripts.
export async function createRuntime(config, log = console.log) {
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const store = createPgStore(pool);
  await store.init();
  const sync = createSync({
    github: createGitHubClient(config.github),
    discord: createDiscordClient(config.discord),
    store,
    settings: config.board,
    channelId: config.discord.gigChannelId,
    projectId: config.github.projectId,
    log,
  });
  return { sync, close: () => pool.end() };
}
