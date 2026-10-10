// Which forum channel a gig goes to. Each board in the settings matches on
// the Project's Type field or on issue labels; the first match wins, and
// anything unmatched goes to the default board (DISCORD_GIG_CHANNEL_ID).
//
//   "boards": [{ "name": "Art", "channel": "$DISCORD_ART_CHANNEL_ID",
//                "types": ["Art"], "labels": ["art"] }]
//
// `channel` is a channel id, or "$NAME" to read it from that env variable.

const lower = (list) => new Set((list || []).map((v) => v.toLowerCase()));

export function resolveBoards(settings, env, defaultChannelId) {
  const boards = (settings.boards || []).map((b, i) => {
    if (!b.name || !b.channel) throw new Error(`boards[${i}] needs a name and a channel`);
    const channelId = b.channel.startsWith('$') ? env[b.channel.slice(1)] : b.channel;
    if (!channelId) throw new Error(`Missing environment variable ${b.channel.slice(1)} for the ${b.name} board`);
    return { name: b.name, channelId, types: lower(b.types), labels: lower(b.labels) };
  });
  const ids = [defaultChannelId, ...boards.map((b) => b.channelId)];
  if (new Set(ids).size !== ids.length) throw new Error('Each board needs its own forum channel');
  return [...boards, { name: settings.defaultBoard, channelId: defaultChannelId, types: new Set(), labels: new Set() }];
}

export function createRouter(boards) {
  const fallback = boards.at(-1);
  return {
    boards,
    defaultChannelId: fallback.channelId,

    // item: { fields: { type }, issue: { labels } }
    channelFor(item) {
      const type = (item.fields?.type || '').toLowerCase();
      const labels = (item.issue?.labels || []).map((l) => l.toLowerCase());
      const board = boards.find((b) => (type && b.types.has(type)) || labels.some((l) => b.labels.has(l)));
      return (board || fallback).channelId;
    },

    nameOf(channelId) {
      return (boards.find((b) => b.channelId === channelId) || fallback).name;
    },
  };
}
