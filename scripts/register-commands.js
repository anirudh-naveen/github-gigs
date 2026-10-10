// Registers the slash commands with Discord. Rerun after changing them.
// With DISCORD_GUILD_ID set they appear in that server instantly; without
// it they are global and can take up to an hour.
//   railway run npm run register-commands
import { createDiscordClient } from '../src/discord.js';

const { DISCORD_APPLICATION_ID: appId, DISCORD_BOT_TOKEN: botToken, DISCORD_GUILD_ID: guildId } = process.env;
if (!appId || !botToken) throw new Error('Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN');

const GUILD_ONLY = [0];
const commands = [
  { name: 'link', description: 'Link your GitHub account so you can claim gigs' },
  { name: 'claim', description: 'Request this gig (run it inside a gig post)' },
  { name: 'unclaim', description: 'Release your claim or request on this gig' },
  { name: 'gigs', description: 'List open gigs' },
].map((c) => ({ ...c, type: 1, contexts: GUILD_ONLY }));

const discord = createDiscordClient({ botToken, apiUrl: process.env.DISCORD_API_URL || undefined });
const path = guildId
  ? `/applications/${appId}/guilds/${guildId}/commands`
  : `/applications/${appId}/commands`;
const saved = await discord.request('PUT', path, commands);
console.log(`registered ${saved.length} commands ${guildId ? `in guild ${guildId}` : 'globally'}: ${saved.map((c) => `/${c.name}`).join(' ')}`);
