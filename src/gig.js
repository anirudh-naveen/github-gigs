// Turns a GitHub issue plus its Project fields into a Discord forum post.
//
// A gig looks like:
// {
//   number, title, body, url,
//   labels: ['frontend', 'difficulty: medium', ...],
//   fields: { status, difficulty, bounty, area },   // from the Project
//   claim: { discordId, githubLogin } | null,
// }

import { DEFAULTS } from './settings.js';

export const LIMITS = { title: 100, content: 2000, tags: 5 };

const NO_MENTIONS = { parse: [] };

export function clip(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

function paragraphs(body) {
  return (body || '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

const REQUIREMENTS_HEADING = /^\*\*Requirements\*\*:?\s*$/im;

// The first paragraph of the issue body, unless it is the requirements list.
export function description(body) {
  const first = paragraphs(body)[0] || '';
  if (REQUIREMENTS_HEADING.test(first.split('\n')[0]) || /^\s*[-*] /.test(first)) return '';
  return first;
}

// Bullets that follow the **Requirements** heading.
export function requirements(body) {
  const lines = (body || '').replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => REQUIREMENTS_HEADING.test(line.trim()));
  if (start === -1) return [];
  const bullets = [];
  for (const line of lines.slice(start + 1)) {
    const match = line.match(/^\s*[-*]\s+(.*)$/);
    if (match) bullets.push(match[1].trim());
    else if (line.trim() && bullets.length) break;
  }
  return bullets;
}

function capitalize(word) {
  return word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : '';
}

// The Project field wins; the old `difficulty: x` label is the fallback.
export function difficulty(gig) {
  if (gig.fields?.difficulty) return gig.fields.difficulty;
  const label = (gig.labels || []).find((l) => /^difficulty:\s*/i.test(l));
  return label ? capitalize(label.replace(/^difficulty:\s*/i, '')) : '';
}

// Only the maintainer sets Bounty, and only in the Project field.
export function bounty(gig) {
  return (gig.fields?.bounty || '').trim();
}

// The Project field wins; otherwise the first label listed in areaTags.
export function area(gig, settings = DEFAULTS) {
  if (gig.fields?.area) return gig.fields.area;
  return (gig.labels || []).find((l) => settings.areaTags[l.toLowerCase()]) || '';
}

// Private areas (e.g. security) go through private advisories, never the board.
export function shouldMirror(gig, settings = DEFAULTS) {
  const hidden = new Set(settings.privateAreas.map((a) => a.toLowerCase()));
  if (hidden.has(area(gig, settings).toLowerCase())) return false;
  return !(gig.labels || []).some((l) => hidden.has(l.toLowerCase()));
}

// availableTags is the forum channel's `available_tags` ([{ id, name }]).
export function tagIds(gig, availableTags, settings = DEFAULTS) {
  const wanted = [];
  if (gig.claim) wanted.push(settings.claimedTag);
  const gigArea = area(gig, settings);
  if (gigArea) wanted.push(settings.areaTags[gigArea.toLowerCase()] || gigArea);
  if (difficulty(gig)) wanted.push(difficulty(gig));
  for (const label of gig.labels || []) {
    const key = label.toLowerCase();
    const name = settings.labelTags[key] || settings.areaTags[key];
    if (name) wanted.push(name);
  }
  const byName = new Map(availableTags.map((t) => [t.name.toLowerCase(), t.id]));
  const ids = [];
  for (const name of wanted) {
    const id = byName.get(name.toLowerCase());
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, LIMITS.tags);
}

export function gigTitle(gig) {
  return clip(`#${gig.number} ${gig.title}`.trim(), LIMITS.title);
}

export function gigContent(gig, settings = DEFAULTS) {
  const head = [
    `**Difficulty**: ${difficulty(gig) || '—'}`,
    `**Bounty**: ${bounty(gig) || '—'}`,
  ];
  if (gig.claim) {
    head.push(`🔒 Claimed by <@${gig.claim.discordId}> (GitHub: ${gig.claim.githubLogin})`);
  }

  const middle = [];
  const desc = description(gig.body);
  if (desc) middle.push(`**Description**\n${desc}`);
  const reqs = requirements(gig.body);
  if (reqs.length) middle.push(`**Requirements**\n${reqs.map((r) => `- ${r}`).join('\n')}`);

  const verb = settings.claims.requireApproval ? 'request' : 'claim';
  const foot = gig.claim
    ? `Issue: <${gig.url}>`
    : `Want it? Run \`/claim\` in this post to ${verb} it. Issue: <${gig.url}>`;

  const headText = head.join('\n');
  const budget = LIMITS.content - headText.length - foot.length - 4;
  const middleText = clip(middle.join('\n\n'), Math.max(budget, 0));
  return [headText, middleText, foot].filter(Boolean).join('\n\n');
}

// Body for POST /channels/{forum}/threads.
export function gigPost(gig, availableTags, settings = DEFAULTS) {
  return {
    name: gigTitle(gig),
    applied_tags: tagIds(gig, availableTags, settings),
    message: { content: gigContent(gig, settings), allowed_mentions: NO_MENTIONS },
  };
}

// Bodies for updating an existing post: the thread (title, tags) and its
// starter message (content). The starter message id equals the thread id.
export function gigUpdate(gig, availableTags, settings = DEFAULTS) {
  return {
    thread: { name: gigTitle(gig), applied_tags: tagIds(gig, availableTags, settings) },
    message: { content: gigContent(gig, settings), allowed_mentions: NO_MENTIONS },
  };
}
