// Makes every forum post match the Project: posts missing gigs, refreshes
// existing ones, and deletes posts for gigs that are gone. Safe to rerun.
//   railway run npm run backfill
import { loadConfig } from '../src/config.js';
import { createRuntime } from '../src/runtime.js';

const runtime = await createRuntime(loadConfig());
try {
  const counts = await runtime.sync.backfill();
  console.log(`backfill done: ${JSON.stringify(counts)}`);
} finally {
  await runtime.close();
}
