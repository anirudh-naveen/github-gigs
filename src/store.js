// Which Project item owns which forum post. Needed because once an item is
// removed from the Project, GitHub can no longer tell us its thread.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS gigs (
  project_item_id       text PRIMARY KEY,
  issue_repo            text NOT NULL,
  issue_number          integer NOT NULL,
  thread_id             text,
  claimed_by_discord_id text,
  claimed_by_github     text,
  status                text,
  updated_at            timestamptz NOT NULL DEFAULT now()
)`;

function fromRow(row) {
  return {
    itemId: row.project_item_id,
    repo: row.issue_repo,
    number: row.issue_number,
    threadId: row.thread_id,
    status: row.status,
  };
}

export function createPgStore(pool) {
  return {
    async init() {
      await pool.query(SCHEMA);
    },
    async get(itemId) {
      const { rows } = await pool.query('SELECT * FROM gigs WHERE project_item_id = $1', [itemId]);
      return rows[0] ? fromRow(rows[0]) : null;
    },
    async save({ itemId, repo, number, threadId, status }) {
      await pool.query(
        `INSERT INTO gigs (project_item_id, issue_repo, issue_number, thread_id, status)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (project_item_id) DO UPDATE SET
           issue_repo = EXCLUDED.issue_repo,
           issue_number = EXCLUDED.issue_number,
           thread_id = EXCLUDED.thread_id,
           status = EXCLUDED.status,
           updated_at = now()`,
        [itemId, repo, number, threadId, status],
      );
    },
    async remove(itemId) {
      await pool.query('DELETE FROM gigs WHERE project_item_id = $1', [itemId]);
    },
    async all() {
      const { rows } = await pool.query('SELECT * FROM gigs');
      return rows.map(fromRow);
    },
  };
}

// For tests and local dry runs.
export function createMemoryStore() {
  const rows = new Map();
  return {
    async init() {},
    async get(itemId) {
      return rows.has(itemId) ? { ...rows.get(itemId) } : null;
    },
    async save(row) {
      rows.set(row.itemId, { ...row });
    },
    async remove(itemId) {
      rows.delete(itemId);
    },
    async all() {
      return [...rows.values()].map((r) => ({ ...r }));
    },
  };
}
