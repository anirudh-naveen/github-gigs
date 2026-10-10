import { isGone } from './discord.js';
import { gigPost, gigUpdate, shouldMirror } from './gig.js';

const ISSUE_ACTIONS = new Set(['edited', 'closed', 'reopened', 'labeled', 'unlabeled', 'assigned', 'unassigned']);
const TAG_CACHE_MS = 5 * 60 * 1000;

// Keeps the forum in step with the Project. Every change funnels into
// reconcile(itemId), which reads the item fresh and makes the post match, so
// events can arrive out of order or twice without harm.
export function createSync({ github, discord, store, settings, channelId, projectId, log = console.log }) {
  // One reconcile per item at a time, so two quick events can't both create a post.
  const locks = new Map();
  function withLock(key, fn) {
    const run = (locks.get(key) || Promise.resolve()).then(fn);
    const tail = run.catch(() => {});
    locks.set(key, tail);
    tail.then(() => locks.get(key) === tail && locks.delete(key));
    return run;
  }

  let tagCache = { at: 0, tags: [] };
  async function forumTags() {
    if (Date.now() - tagCache.at > TAG_CACHE_MS) {
      tagCache = { at: Date.now(), tags: await discord.getForumTags(channelId) };
    }
    return tagCache.tags;
  }

  const postStatuses = new Set(settings.postStatuses.map((s) => s.toLowerCase()));

  // A claim made through the bot names the Discord user; otherwise an
  // assignee set on GitHub counts as the claimant.
  function claimOf(item, row) {
    if (row?.claim) return row.claim;
    const login = item.issue.assignees?.[0];
    return login ? { discordId: null, githubLogin: login } : null;
  }

  function toGig(item, row) {
    const { issue } = item;
    return {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      url: issue.url,
      labels: issue.labels,
      fields: item.fields,
      claim: claimOf(item, row),
    };
  }

  function wanted(item, row) {
    if (!item || item.projectId !== projectId || item.isArchived || !item.issue) return null;
    if (item.issue.state !== 'OPEN') return null;
    if (!postStatuses.has(item.fields.status.toLowerCase())) return null;
    const gig = toGig(item, row);
    return shouldMirror(gig, settings) ? gig : null;
  }

  async function reconcile(itemId) {
    return withLock(itemId, async () => {
      const row = await store.get(itemId);
      const item = await github.getItem(itemId, settings.fields);
      const gig = wanted(item, row);

      if (gig) {
        const tags = await forumTags();
        const record = {
          itemId,
          repo: item.issue.repo,
          number: item.issue.number,
          status: item.fields.status,
        };
        if (row?.threadId) {
          try {
            await discord.updatePost(row.threadId, gigUpdate(gig, tags, settings));
            await store.save({ ...record, threadId: row.threadId });
            return 'updated';
          } catch (err) {
            if (!isGone(err)) throw err;
            log(`thread ${row.threadId} for ${record.repo}#${record.number} was gone; reposting`);
          }
        }
        const threadId = await discord.createPost(channelId, gigPost(gig, tags, settings));
        await store.save({ ...record, threadId });
        return 'created';
      }

      if (!row) return 'skipped';
      if (row.threadId) await discord.deletePost(row.threadId);
      await store.remove(itemId);
      return row.threadId ? 'deleted' : 'skipped';
    });
  }

  async function reconcileAndLog(itemId) {
    const result = await reconcile(itemId);
    if (result !== 'skipped') log(`gig ${itemId}: ${result}`);
    return result;
  }

  return {
    reconcile,

    async handleEvent(event, payload) {
      if (event === 'projects_v2_item') {
        const item = payload.projects_v2_item;
        if (item?.project_node_id !== projectId || payload.action === 'reordered') return;
        await reconcileAndLog(item.node_id);
      } else if (event === 'issues' && ISSUE_ACTIONS.has(payload.action)) {
        const ids = await github.itemsForIssue(payload.issue.node_id, projectId);
        for (const id of ids) await reconcileAndLog(id);
      }
    },

    // Brings every post in line with the Project, including items removed
    // while the bot was down. Safe to run any time.
    async backfill() {
      const counts = { created: 0, updated: 0, deleted: 0, skipped: 0 };
      const ids = await github.listItems(projectId);
      const seen = new Set(ids);
      const stale = (await store.all()).map((r) => r.itemId).filter((id) => !seen.has(id));
      for (const id of [...ids, ...stale]) counts[await reconcileAndLog(id)]++;
      return counts;
    },
  };
}
