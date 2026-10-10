import { loadSettings } from './settings.js';

// Reads settings from the environment. Secrets are never logged: errors name
// the missing variables, not their values.

const REQUIRED = [
  'DISCORD_APPLICATION_ID',
  'DISCORD_PUBLIC_KEY',
  'DISCORD_BOT_TOKEN',
  'DISCORD_GIG_CHANNEL_ID',
  'GITHUB_WEBHOOK_SECRET',
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_INSTALLATION_ID',
  'GITHUB_PROJECT_ID',
  'DATABASE_URL',
];

export function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  return {
    port: Number(env.PORT) || 3000,
    board: loadSettings(env.GIGS_CONFIG),
    discord: {
      applicationId: env.DISCORD_APPLICATION_ID,
      publicKey: env.DISCORD_PUBLIC_KEY,
      botToken: env.DISCORD_BOT_TOKEN,
      gigChannelId: env.DISCORD_GIG_CHANNEL_ID,
      developerRoleId: env.DISCORD_DEVELOPER_ROLE_ID || null,
      maintainerRoleId: env.DISCORD_MAINTAINER_ROLE_ID || null,
    },
    github: {
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
      installationId: env.GITHUB_INSTALLATION_ID,
      webhookSecret: env.GITHUB_WEBHOOK_SECRET,
      projectId: env.GITHUB_PROJECT_ID,
    },
    databaseUrl: env.DATABASE_URL,
  };
}
