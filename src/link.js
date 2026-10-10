import { createHmac, timingSafeEqual } from 'node:crypto';

// Signed, expiring OAuth `state` that carries the Discord user id through
// GitHub's sign-in, so the callback knows who to link.
const TTL_MS = 10 * 60 * 1000;

function mac(secret, payload) {
  return createHmac('sha256', `link-state:${secret}`).update(payload).digest('hex');
}

export function signState(secret, discordId, now = Date.now()) {
  const payload = `${discordId}.${now + TTL_MS}`;
  return `${payload}.${mac(secret, payload)}`;
}

// The Discord id, or null if the state is forged or expired.
export function readState(secret, state, now = Date.now()) {
  const match = /^(\d+)\.(\d+)\.([0-9a-f]{64})$/.exec(state || '');
  if (!match) return null;
  const [, discordId, expires, sig] = match;
  const expected = Buffer.from(mac(secret, `${discordId}.${expires}`));
  if (!timingSafeEqual(Buffer.from(sig), expected)) return null;
  return Number(expires) >= now ? discordId : null;
}
