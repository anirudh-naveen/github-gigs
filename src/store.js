// Bot state. `gigs` records which Project item owns which forum post (once an
// item leaves the Project, GitHub can no longer tell us), plus claim state.
// `links` maps Discord users to verified GitHub logins.
//
// A gig row: { itemId, repo, number, threadId, channelId, status,
//              claim:   { discordId, githubLogin, at } | null,
//              pending: { discordId, githubLogin, at } | null }

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
);
ALTER TABLE gigs ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE gigs ADD COLUMN IF NOT EXISTS pending_discord_id text;
ALTER TABLE gigs ADD COLUMN IF NOT EXISTS pending_github text;
ALTER TABLE gigs ADD COLUMN IF NOT EXISTS requested_at timestamptz;
ALTER TABLE gigs ADD COLUMN IF NOT EXISTS channel_id text;
CREATE INDEX IF NOT EXISTS gigs_thread_id ON gigs (thread_id);

CREATE TABLE IF NOT EXISTS links (
  discord_id   text PRIMARY KEY,
  github_login text NOT NULL UNIQUE,
  verified_at  timestamptz NOT NULL DEFAULT now()
);`;

function fromRow(row) {
  return {
    itemId: row.project_item_id,
    repo: row.issue_repo,
    number: row.issue_number,
    threadId: row.thread_id,
    channelId: row.channel_id,
    status: row.status,
    claim: row.claimed_by_discord_id
      ? { discordId: row.claimed_by_discord_id, githubLogin: row.claimed_by_github, at: row.claimed_at }
      : null,
    pending: row.pending_discord_id
      ? { discordId: row.pending_discord_id, githubLogin: row.pending_github, at: row.requested_at }
      : null,
  };
}

export function createPgStore(pool) {
  const one = async (sql, args) => {
    const { rows } = await pool.query(sql, args);
    return rows[0] ? fromRow(rows[0]) : null;
  };
  const many = async (sql, args) => (await pool.query(sql, args)).rows.map(fromRow);

  return {
    async init() {
      await pool.query(SCHEMA);
    },
    get: (itemId) => one('SELECT * FROM gigs WHERE project_item_id = $1', [itemId]),
    getByThread: (threadId) => one('SELECT * FROM gigs WHERE thread_id = $1', [threadId]),
    all: () => many('SELECT * FROM gigs ORDER BY issue_repo, issue_number'),

    // Sync fields only; claim state is left alone.
    async save({ itemId, repo, number, threadId, channelId, status }) {
      await pool.query(
        `INSERT INTO gigs (project_item_id, issue_repo, issue_number, thread_id, channel_id, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (project_item_id) DO UPDATE SET
           issue_repo = EXCLUDED.issue_repo,
           issue_number = EXCLUDED.issue_number,
           thread_id = EXCLUDED.thread_id,
           channel_id = EXCLUDED.channel_id,
           status = EXCLUDED.status,
           updated_at = now()`,
        [itemId, repo, number, threadId, channelId, status],
      );
    },
    async remove(itemId) {
      await pool.query('DELETE FROM gigs WHERE project_item_id = $1', [itemId]);
    },

    // Claims and pending requests a user holds, across all gigs.
    async countActive(discordId) {
      const { rows } = await pool.query(
        `SELECT
           count(*) FILTER (WHERE claimed_by_discord_id = $1) +
           count(*) FILTER (WHERE pending_discord_id = $1) AS n
         FROM gigs`,
        [discordId],
      );
      return Number(rows[0].n);
    },
    // Atomic: only one pending request or claim per gig. Returns false if taken.
    async setPending(itemId, discordId, githubLogin) {
      const { rowCount } = await pool.query(
        `UPDATE gigs SET pending_discord_id = $2, pending_github = $3, requested_at = now(), updated_at = now()
         WHERE project_item_id = $1 AND pending_discord_id IS NULL AND claimed_by_discord_id IS NULL`,
        [itemId, discordId, githubLogin],
      );
      return rowCount === 1;
    },
    async clearPending(itemId) {
      await pool.query(
        `UPDATE gigs SET pending_discord_id = NULL, pending_github = NULL, requested_at = NULL, updated_at = now()
         WHERE project_item_id = $1`,
        [itemId],
      );
    },
    async setClaim(itemId, discordId, githubLogin) {
      await pool.query(
        `UPDATE gigs SET claimed_by_discord_id = $2, claimed_by_github = $3, claimed_at = now(),
           pending_discord_id = NULL, pending_github = NULL, requested_at = NULL, updated_at = now()
         WHERE project_item_id = $1`,
        [itemId, discordId, githubLogin],
      );
    },
    async clearClaim(itemId) {
      await pool.query(
        `UPDATE gigs SET claimed_by_discord_id = NULL, claimed_by_github = NULL, claimed_at = NULL, updated_at = now()
         WHERE project_item_id = $1`,
        [itemId],
      );
    },

    async getLink(discordId) {
      const { rows } = await pool.query('SELECT github_login FROM links WHERE discord_id = $1', [discordId]);
      return rows[0]?.github_login ?? null;
    },
    // A GitHub login belongs to one Discord user; relinking moves it.
    async saveLink(discordId, githubLogin) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM links WHERE github_login = $1 AND discord_id <> $2', [githubLogin, discordId]);
        await client.query(
          `INSERT INTO links (discord_id, github_login) VALUES ($1, $2)
           ON CONFLICT (discord_id) DO UPDATE SET github_login = EXCLUDED.github_login, verified_at = now()`,
          [discordId, githubLogin],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

// For tests and local dry runs.
export function createMemoryStore() {
  const gigs = new Map();
  const links = new Map();
  const copy = (row) => (row ? structuredClone(row) : null);
  return {
    async init() {},
    async get(itemId) {
      return copy(gigs.get(itemId));
    },
    async getByThread(threadId) {
      return copy([...gigs.values()].find((r) => r.threadId === threadId));
    },
    async all() {
      return [...gigs.values()].map(copy);
    },
    async save({ itemId, repo, number, threadId, channelId, status }) {
      const prev = gigs.get(itemId) || { claim: null, pending: null };
      gigs.set(itemId, { ...prev, itemId, repo, number, threadId, channelId, status });
    },
    async remove(itemId) {
      gigs.delete(itemId);
    },
    async countActive(discordId) {
      return [...gigs.values()].reduce(
        (n, r) => n + (r.claim?.discordId === discordId) + (r.pending?.discordId === discordId),
        0,
      );
    },
    async setPending(itemId, discordId, githubLogin) {
      const row = gigs.get(itemId);
      if (!row || row.pending || row.claim) return false;
      row.pending = { discordId, githubLogin, at: new Date() };
      return true;
    },
    async clearPending(itemId) {
      if (gigs.has(itemId)) gigs.get(itemId).pending = null;
    },
    async setClaim(itemId, discordId, githubLogin) {
      const row = gigs.get(itemId);
      if (row) Object.assign(row, { claim: { discordId, githubLogin, at: new Date() }, pending: null });
    },
    async clearClaim(itemId) {
      if (gigs.has(itemId)) gigs.get(itemId).claim = null;
    },
    async getLink(discordId) {
      return links.get(discordId) ?? null;
    },
    async saveLink(discordId, githubLogin) {
      for (const [id, login] of links) if (login === githubLogin) links.delete(id);
      links.set(discordId, githubLogin);
    },
  };
}
