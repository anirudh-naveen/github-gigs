import { generateKeyPairSync, sign } from 'node:crypto';

// A throwaway Ed25519 key pair, standing in for a Discord application's.
export function discordKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const hex = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
  const signFor = (timestamp, body) =>
    sign(null, Buffer.concat([Buffer.from(timestamp), body]), privateKey).toString('hex');
  return { hex, signFor };
}
