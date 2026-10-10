import { readFileSync } from 'node:fs';

// Board settings: everything that differs between projects using this bot.
// The defaults are generic. A deployment tunes them with a JSON file named by
// GIGS_CONFIG (see config/example.json), or the same JSON inline in
// GIGS_CONFIG_JSON, which lets you deploy this repo without forking it.
export const DEFAULTS = {
  // Names of the Project's fields.
  fields: { status: 'Status', difficulty: 'Difficulty', bounty: 'Bounty', area: 'Area', type: 'Type' },
  // Statuses that get a forum post. Any other status (including blank, Done)
  // removes it, as do closing the issue and removing it from the Project.
  postStatuses: ['Open', 'Claimed', 'In review'],
  // Status values the bot sets when a gig is claimed or released.
  statuses: { open: 'Open', claimed: 'Claimed' },
  // Extra forum boards, routed by the Type field or labels (see boards.js).
  // Gigs that match none go to the default board, DISCORD_GIG_CHANNEL_ID.
  boards: [],
  defaultBoard: 'Gigs',
  // Project "Area" value or issue label -> forum tag name.
  areaTags: {},
  // Other issue labels -> forum tag name.
  labelTags: { enhancement: 'Feature', bug: 'Bug Fix' },
  // Areas and labels that must never be posted publicly.
  privateAreas: ['security'],
  claimedTag: 'Claimed',
  claims: {
    // true: /claim asks a maintainer; false: first come, first served.
    requireApproval: true,
    maxActivePerUser: 2,
    // A claim lapses this many days after the claimant's last commit on the
    // linked PR (or after approval, if there is no PR yet). 0 = never.
    expireDaysAfterLastCommit: 7,
  },
};

function merge(base, over) {
  const out = { ...base };
  for (const [key, value] of Object.entries(over || {})) {
    const isObject = value && typeof value === 'object' && !Array.isArray(value);
    out[key] = isObject && base[key] && typeof base[key] === 'object' ? merge(base[key], value) : value;
  }
  return out;
}

export function loadSettings(path, read = (p) => readFileSync(p, 'utf8')) {
  if (!path) return DEFAULTS;
  return merge(DEFAULTS, JSON.parse(read(path)));
}

export function settingsFromEnv(env) {
  if (env.GIGS_CONFIG && env.GIGS_CONFIG_JSON) {
    throw new Error('Set GIGS_CONFIG or GIGS_CONFIG_JSON, not both');
  }
  if (env.GIGS_CONFIG_JSON) {
    try {
      return merge(DEFAULTS, JSON.parse(env.GIGS_CONFIG_JSON));
    } catch (err) {
      throw new Error(`GIGS_CONFIG_JSON is not valid JSON: ${err.message}`);
    }
  }
  return loadSettings(env.GIGS_CONFIG);
}
