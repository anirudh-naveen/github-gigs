import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createRuntime } from './runtime.js';

const HOUR_MS = 60 * 60 * 1000;

const config = loadConfig();
const { sync, claims } = await createRuntime(config);

createApp(config, {
  onGitHubEvent: (event, payload) => sync.handleEvent(event, payload),
  onInteraction: (interaction) => claims.handleInteraction(interaction),
  onLinkCallback: (query) => claims.linkCallback(query),
}).listen(config.port, () => {
  console.log(`github-gigs listening on :${config.port}`);
  // Catch up on anything missed while the bot was down (or never ran).
  sync.backfill()
    .then((counts) => console.log(`startup backfill: ${JSON.stringify(counts)}`))
    .catch((err) => console.log(`startup backfill failed: ${err.message}`));
});

async function expireClaims() {
  try {
    const expired = await claims.expire();
    if (expired.length) console.log(`expired ${expired.length} claim(s)`);
  } catch (err) {
    console.log(`claim expiry failed: ${err.message}`);
  }
}
setTimeout(expireClaims, 60 * 1000);
setInterval(expireClaims, HOUR_MS);
