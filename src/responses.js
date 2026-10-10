// Discord interaction response helpers.
export const MESSAGE = 4;
export const DEFERRED_MESSAGE = 5;
export const DEFERRED_UPDATE = 6;
export const UPDATE_MESSAGE = 7;
export const EPHEMERAL = 64;

export const NO_MENTIONS = { parse: [] };

export function ephemeral(content, components) {
  return {
    type: MESSAGE,
    data: { content, flags: EPHEMERAL, allowed_mentions: NO_MENTIONS, ...(components && { components }) },
  };
}

export function publicMessage(content, { allowed_mentions = NO_MENTIONS, components } = {}) {
  return { type: MESSAGE, data: { content, allowed_mentions, ...(components && { components }) } };
}
