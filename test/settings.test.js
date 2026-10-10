import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS, loadSettings, settingsFromEnv } from '../src/settings.js';

test('no path gives the generic defaults', () => {
  assert.equal(loadSettings(undefined), DEFAULTS);
});

test('a config file overrides defaults deeply', () => {
  const s = loadSettings('x', () => '{"claims":{"maxActivePerUser":3},"privateAreas":[]}');
  assert.equal(s.claims.maxActivePerUser, 3);
  assert.equal(s.claims.requireApproval, true);
  assert.deepEqual(s.privateAreas, []);
  assert.deepEqual(s.labelTags, DEFAULTS.labelTags);
});

test('the AniLounge config matches the agreed rules', () => {
  const s = loadSettings('config/anilounge.json');
  assert.deepEqual(s.claims, { requireApproval: true, maxActivePerUser: 2, expireDaysAfterLastCommit: 7 });
  assert.equal(s.areaTags.content, undefined); // Content is a board (Type), not an Area
  assert.deepEqual(s.boards.map((b) => b.name), ['Content', 'Art']);
});

test('GIGS_CONFIG_JSON configures without a file', () => {
  const s = settingsFromEnv({ GIGS_CONFIG_JSON: '{"defaultBoard":"Tasks","claims":{"maxActivePerUser":1}}' });
  assert.equal(s.defaultBoard, 'Tasks');
  assert.equal(s.claims.maxActivePerUser, 1);
  assert.equal(s.claims.expireDaysAfterLastCommit, 7);
  assert.equal(settingsFromEnv({}), DEFAULTS);
  assert.throws(() => settingsFromEnv({ GIGS_CONFIG_JSON: '{nope' }), /not valid JSON/);
  assert.throws(() => settingsFromEnv({ GIGS_CONFIG: 'a', GIGS_CONFIG_JSON: '{}' }), /not both/);
});

test('the example config is valid and uses only known keys', () => {
  const raw = JSON.parse(readFileSync('config/example.json', 'utf8'));
  const known = new Set([...Object.keys(DEFAULTS), '$comment']);
  assert.deepEqual(Object.keys(raw).filter((k) => !known.has(k)), []);
  assert.ok(loadSettings('config/example.json').boards.length > 0);
});
