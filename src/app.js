import express from 'express';
import { ephemeral } from './responses.js';
import { discordPublicKey, verifyDiscordSignature, verifyGitHubSignature } from './verify.js';

export { ephemeral };

// Discord interaction types.
const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;
const PONG = 1;

const defaultHandlers = {
  async onGitHubEvent(event, payload, log) {
    log(`github ${event}${payload.action ? `.${payload.action}` : ''} received`);
  },
  // Returns { response, followUp? }; followUp runs after the response is sent.
  async onInteraction(interaction) {
    return { response: ephemeral(`\`/${interaction.data?.name}\` is not available.`) };
  },
  async onLinkCallback() {
    return { status: 404, html: 'Not found' };
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

  app.get('/github/oauth/callback', async (req, res) => {
    const { status, html } = await handlers.onLinkCallback({
      code: String(req.query.code || ''),
      state: String(req.query.state || ''),
    });
    res.status(status).type('html').send(html);
  });

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

    if (interaction.type !== APPLICATION_COMMAND && interaction.type !== MESSAGE_COMPONENT) {
      return res.status(400).json({ error: 'unsupported interaction' });
    }
    const { developerRoleId, maintainerRoleId } = config.discord;
    if (!hasRole(interaction, developerRoleId) && !hasRole(interaction, maintainerRoleId)) {
      return res.json(ephemeral('You need the Developer role to use gig commands.'));
    }
    let result;
    try {
      result = await handlers.onInteraction(interaction);
    } catch (err) {
      log(`/${interaction.data?.name || interaction.data?.custom_id} failed: ${err.message}`);
      return res.json(ephemeral('Something went wrong. Try again later.'));
    }
    res.json(result.response);
    if (result.followUp) {
      try {
        await result.followUp();
      } catch (err) {
        log(`follow-up for ${interaction.data?.name || interaction.data?.custom_id} failed: ${err.message}`);
      }
    }
  });

  return app;
}
