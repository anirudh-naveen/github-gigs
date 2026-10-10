import { createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';

// GitHub signs the raw body with HMAC SHA-256 in X-Hub-Signature-256.
export function verifyGitHubSignature(secret, rawBody, header) {
  if (!secret || !header || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from(
    'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex'),
  );
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// DER prefix that wraps a raw 32-byte Ed25519 public key as SPKI.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function discordPublicKey(hex) {
  const raw = Buffer.from(hex, 'hex');
  if (raw.length !== 32) throw new Error('DISCORD_PUBLIC_KEY must be 32 bytes of hex');
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

// Discord signs timestamp + raw body with Ed25519 (X-Signature-Ed25519,
// X-Signature-Timestamp).
export function verifyDiscordSignature(publicKey, rawBody, signature, timestamp) {
  if (!signature || !timestamp || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  try {
    return verify(
      null,
      Buffer.concat([Buffer.from(timestamp), rawBody]),
      publicKey,
      Buffer.from(signature, 'hex'),
    );
  } catch {
    return false;
  }
}
