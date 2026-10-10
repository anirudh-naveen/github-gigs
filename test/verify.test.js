import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { discordPublicKey, verifyDiscordSignature, verifyGitHubSignature } from '../src/verify.js';
import { discordKeys } from './helpers.js';

test('GitHub HMAC: accepts a valid signature, rejects the rest', () => {
  const body = Buffer.from('{"action":"edited"}');
  const good = 'sha256=' + createHmac('sha256', 's3cret').update(body).digest('hex');
  assert.equal(verifyGitHubSignature('s3cret', body, good), true);
  assert.equal(verifyGitHubSignature('other', body, good), false);
  assert.equal(verifyGitHubSignature('s3cret', Buffer.from('{}'), good), false);
  assert.equal(verifyGitHubSignature('s3cret', body, undefined), false);
  assert.equal(verifyGitHubSignature('s3cret', body, 'sha256=abc'), false);
  assert.equal(verifyGitHubSignature('s3cret', body, good.replace('sha256=', 'sha1=')), false);
});

test('Discord Ed25519: accepts a valid signature, rejects the rest', () => {
  const { hex, signFor } = discordKeys();
  const key = discordPublicKey(hex);
  const body = Buffer.from('{"type":1}');
  const sig = signFor('1700000000', body);
  assert.equal(verifyDiscordSignature(key, body, sig, '1700000000'), true);
  assert.equal(verifyDiscordSignature(key, body, sig, '1700000001'), false);
  assert.equal(verifyDiscordSignature(key, Buffer.from('{"type":2}'), sig, '1700000000'), false);
  assert.equal(verifyDiscordSignature(key, body, undefined, '1700000000'), false);
  assert.equal(verifyDiscordSignature(key, body, 'zz', '1700000000'), false);
  const otherKey = discordPublicKey(discordKeys().hex);
  assert.equal(verifyDiscordSignature(otherKey, body, sig, '1700000000'), false);
});

test('discordPublicKey rejects keys of the wrong length', () => {
  assert.throws(() => discordPublicKey('abcd'));
});
