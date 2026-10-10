import express from 'express';
import { discordPublicKey, verifyDiscordSignature, verifyGitHubSignature } from './verify.js';

// Discord interaction and response types.
const PING = 1;
const APPLICATION_COMMAND = 2;
const PONG = 1;
const CHANNEL_MESSAGE = 4;
const EPHEMERAL = 64;

export function ephemeral(content) {
  return {
    type: CHANNEL_MESSAGE,
    data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
  };
}

const defaultHandlers = {
  // Phase 4 replaces this with Project -> Discord sync.
  async onGitHubEvent(event, payload, log) {
    log(`github ${event}${payload.action ? `.${payload.action}` : ''} received`);
  },
  // Phase 5 replaces this with /link, /claim, /unclaim and /gigs.
  async onCommand(interaction) {
    return ephemeral(`\`/${interaction.data?.name}\` is not available yet.`);
  },
};

function hasRole(interaction, roleId) {
  return Boolean(roleId) && (interaction.member?.roles || []).includes(roleId);
}

export function createApp(config, overrides = {}, log = console.log) {
  const handlers = { ...defaultHandlers, ...overrides };
  const publicKey = discordPublicKey(config.discord.publicKey);
  const app = express();
  app.disable('x-powered-by');

  const rawJson = express.raw({ type: 'application/json', limit: '1mb' });

  app.get('/health', (req, res) => res.json({ ok: true }));

  app.post('/github/webhook', rawJson, async (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifyGitHubSignature(config.github.webhookSecret, body, req.get('x-hub-signature-256'))) {
      return res.status(401).json({ error: 'bad signature' });
    }
    const event = req.get('x-github-event');
    let payload;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'bad json' });
    }
    if (event === 'ping') return res.json({ ok: true });

    // Acknowledge first: GitHub times out after 10 seconds.
    res.status(202).json({ ok: true });
    try {
      await handlers.onGitHubEvent(event, payload, log);
    } catch (err) {
      log(`github ${event} handler failed: ${err.message}`);
    }
  });

  app.post('/discord/interactions', rawJson, async (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const ok = verifyDiscordSignature(
      publicKey,
      body,
      req.get('x-signature-ed25519'),
      req.get('x-signature-timestamp'),
    );
    if (!ok) return res.status(401).json({ error: 'bad signature' });

    let interaction;
    try {
      interaction = JSON.parse(body.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'bad json' });
    }

    if (interaction.type === PING) return res.json({ type: PONG });

    if (interaction.type === APPLICATION_COMMAND) {
      const { developerRoleId, maintainerRoleId } = config.discord;
      if (!hasRole(interaction, developerRoleId) && !hasRole(interaction, maintainerRoleId)) {
        return res.json(ephemeral('You need the Developer role to use gig commands.'));
      }
      try {
        return res.json(await handlers.onCommand(interaction, config));
      } catch (err) {
        log(`/${interaction.data?.name} failed: ${err.message}`);
        return res.json(ephemeral('Something went wrong. Try again later.'));
      }
    }

    return res.status(400).json({ error: 'unsupported interaction' });
  });

  return app;
}
