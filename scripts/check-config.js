// Checks this deployment's settings against the live GitHub and Discord.
// Read-only. Run it after setup or after changing anything:
//   railway run npm run check-config
import { diagnose } from '../src/doctor.js';
import { createDiscordClient } from '../src/discord.js';
import { createGitHubClient } from '../src/github.js';
import { loadConfig } from '../src/config.js';

const ICON = { ok: '✓', warn: '!', error: '✗' };

let config;
try {
  config = loadConfig();
} catch (err) {
  console.log(`✗ ${err.message}`);
  process.exit(1);
}
const results = await diagnose({
  config,
  github: createGitHubClient(config.github),
  discord: createDiscordClient(config.discord),
  guildId: process.env.DISCORD_GUILD_ID,
});
for (const r of results) console.log(`${ICON[r.level]} ${r.message}`);
const errors = results.filter((r) => r.level === 'error').length;
const warnings = results.filter((r) => r.level === 'warn').length;
console.log(`\n${errors} error(s), ${warnings} warning(s)`);
process.exitCode = errors ? 1 : 0;
