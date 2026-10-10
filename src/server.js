import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createRuntime } from './runtime.js';

const config = loadConfig();
const { sync } = await createRuntime(config);

createApp(config, {
  onGitHubEvent: (event, payload) => sync.handleEvent(event, payload),
}).listen(config.port, () => {
  console.log(`github-gigs listening on :${config.port}`);
});
