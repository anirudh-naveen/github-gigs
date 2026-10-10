const API = 'https://discord.com/api/v10';

export class DiscordError extends Error {
  constructor(status, method, path, detail) {
    super(`Discord ${method} ${path} failed: ${status} ${detail}`);
    this.status = status;
  }
}

// Unknown channel / message: the post was already deleted.
export function isGone(err) {
  return err instanceof DiscordError && err.status === 404;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createDiscordClient({ botToken, apiUrl = API }, fetchImpl = fetch, wait = sleep) {
  async function request(method, path, body) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetchImpl(`${apiUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'DiscordBot (https://github.com/anirudh-naveen/github-gigs, 0.1.0)',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 429) {
        const json = await res.json().catch(() => ({}));
        await wait(Math.ceil((json.retry_after ?? 1) * 1000));
        continue;
      }
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 200);
        throw new DiscordError(res.status, method, path, detail);
      }
      return res.status === 204 ? null : res.json();
    }
    throw new DiscordError(429, method, path, 'still rate limited after retries');
  }

  return {
    request,

    async getForumTags(channelId) {
      const channel = await request('GET', `/channels/${channelId}`);
      return channel.available_tags || [];
    },

    // Returns the new thread id. A forum post's starter message shares it.
    async createPost(channelId, post) {
      const thread = await request('POST', `/channels/${channelId}/threads`, post);
      return thread.id;
    },

    // Unarchive first: messages in archived threads cannot be edited.
    async updatePost(threadId, update) {
      await request('PATCH', `/channels/${threadId}`, { ...update.thread, archived: false });
      await request('PATCH', `/channels/${threadId}/messages/${threadId}`, update.message);
    },

    async sendMessage(channelId, message) {
      return request('POST', `/channels/${channelId}/messages`, message);
    },

    // Edits the reply to a deferred interaction.
    async editOriginal(applicationId, token, message) {
      return request('PATCH', `/webhooks/${applicationId}/${token}/messages/@original`, message);
    },

    async deletePost(threadId) {
      try {
        await request('DELETE', `/channels/${threadId}`);
      } catch (err) {
        if (!isGone(err)) throw err;
      }
    },
  };
}
