import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, area, bounty, description, difficulty, gigContent, gigPost, gigTitle,
  requirements, shouldMirror, tagIds,
} from '../src/gig.js';
import { DEFAULTS, loadSettings } from '../src/settings.js';

const S = loadSettings('config/anilounge.json');

const BODY = `Move user avatars from the database to Cloudflare R2.

**Requirements**
- Upload new avatars to R2
- Serve them through the CDN
- Migrate existing avatars

Notes for reviewers go here.`;

const gig = (over = {}) => ({
  number: 78,
  title: 'Avatars → Cloudflare R2',
  body: BODY,
  url: 'https://github.com/anilounge/anilounge/issues/78',
  labels: ['backend', 'difficulty: medium', 'enhancement'],
  fields: {},
  claim: null,
  ...over,
});

const TAGS = [
  { id: '1', name: 'Feature' },
  { id: '2', name: 'Bug Fix' },
  { id: '3', name: 'Frontend' },
  { id: '4', name: 'Backend' },
  { id: '5', name: 'Medium' },
  { id: '6', name: 'Claimed' },
  { id: '7', name: 'Content Update' },
];

test('description is the first paragraph', () => {
  assert.equal(description(BODY), 'Move user avatars from the database to Cloudflare R2.');
  assert.equal(description('**Requirements**\n- a'), '');
  assert.equal(description(''), '');
});

test('requirements are the bullets under the heading', () => {
  assert.deepEqual(requirements(BODY), [
    'Upload new avatars to R2',
    'Serve them through the CDN',
    'Migrate existing avatars',
  ]);
  assert.deepEqual(requirements('no list'), []);
  assert.deepEqual(requirements('**Requirements**\r\n\r\n* one\r\n* two'), ['one', 'two']);
});

test('Project fields win over labels', () => {
  assert.equal(difficulty(gig()), 'Medium');
  assert.equal(difficulty(gig({ fields: { difficulty: 'Hard' } })), 'Hard');
  assert.equal(area(gig(), S), 'backend');
  assert.equal(area(gig({ fields: { area: 'Mobile' } }), S), 'Mobile');
});

test('bounty comes only from the Project field, never the body', () => {
  assert.equal(bounty(gig({ body: '**Bounty**: $50' })), '');
  assert.equal(bounty(gig({ fields: { bounty: ' $50 ' } })), '$50');
});

test('security gigs are never mirrored', () => {
  assert.equal(shouldMirror(gig(), S), true);
  assert.equal(shouldMirror(gig({ labels: ['security'] }), S), false);
  assert.equal(shouldMirror(gig({ fields: { area: 'Security' } }), S), false);
});

test('tags map by name, dedupe, and cap at 5', () => {
  assert.deepEqual(tagIds(gig(), TAGS, S), ['4', '5', '1']);
  const many = gig({
    claim: { discordId: '9', githubLogin: 'x' },
    labels: ['frontend', 'backend', 'content', 'bug', 'enhancement', 'difficulty: medium'],
  });
  const ids = tagIds(many, TAGS, S);
  assert.equal(ids.length, LIMITS.tags);
  assert.equal(ids[0], '6');
  assert.equal(new Set(ids).size, ids.length);
});

test('title is clipped to 100 chars', () => {
  assert.equal(gigTitle(gig()), '#78 Avatars → Cloudflare R2');
  const long = gigTitle(gig({ title: 'x'.repeat(300) }));
  assert.equal(long.length, LIMITS.title);
  assert.ok(long.endsWith('…'));
});

test('content has the gig sections', () => {
  const content = gigContent(gig({ fields: { bounty: '$50' } }), S);
  assert.match(content, /\*\*Difficulty\*\*: Medium/);
  assert.match(content, /\*\*Bounty\*\*: \$50/);
  assert.match(content, /\*\*Description\*\*\nMove user avatars/);
  assert.match(content, /- Migrate existing avatars/);
  assert.match(content, /`\/claim` in this post to request it/);
  assert.doesNotMatch(content, /Notes for reviewers/);
});

test('claimed gigs show the claimant', () => {
  const content = gigContent(gig({ claim: { discordId: '123', githubLogin: 'octo' } }));
  assert.match(content, /🔒 Claimed by <@123> \(GitHub: octo\)/);
  assert.doesNotMatch(content, /\/claim/);
});

test('content is clipped to 2000 chars and keeps the issue link', () => {
  const huge = `${'word '.repeat(1000)}\n\n**Requirements**\n${'- item\n'.repeat(500)}`;
  const content = gigContent(gig({ body: huge }));
  assert.ok(content.length <= LIMITS.content, `length ${content.length}`);
  assert.ok(content.endsWith('<https://github.com/anilounge/anilounge/issues/78>'));
});

test('posts never allow mentions', () => {
  const post = gigPost(gig({ body: '@everyone look\n\n**Requirements**\n- <@&1>' }), TAGS);
  assert.deepEqual(post.message.allowed_mentions, { parse: [] });
});

test('generic defaults: no area tags, label tags still apply', () => {
  assert.equal(area(gig(), DEFAULTS), '');
  assert.deepEqual(tagIds(gig(), TAGS, DEFAULTS), ['5', '1']);
  assert.equal(shouldMirror(gig({ labels: ['security'] }), DEFAULTS), false);
});

test('first-come boards say claim, not request', () => {
  const firstCome = loadSettings('x', () => '{"claims":{"requireApproval":false}}');
  assert.match(gigContent(gig(), firstCome), /to claim it/);
});
