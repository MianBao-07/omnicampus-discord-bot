import { REST, Routes } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { slashCommands } from './commands.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.resolve(__dirname, '..', '.env');

if (fs.existsSync(ENV_PATH) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(ENV_PATH);
  } catch {}
}

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  console.error('[Error] DISCORD_TOKEN and DISCORD_CLIENT_ID must be set in your .env file.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function deploy() {
  try {
    const commandsJson = slashCommands.map(cmd => cmd.toJSON());
    console.log(`[Deploy] Refreshing ${commandsJson.length} application (/) commands...`);

    if (guildId && guildId.trim() !== '') {
      // Guild-specific registration (instant updates during dev/testing)
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId.trim()),
        { body: commandsJson }
      );
      console.log(`[Deploy] Successfully registered commands to Guild ID: ${guildId}`);
    } else {
      // Global registration (available across all servers the bot joins)
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commandsJson }
      );
      console.log(`[Deploy] Successfully registered global commands!`);
    }
  } catch (err) {
    console.error('[Deploy] Failed to register slash commands:', err);
    process.exit(1);
  }
}

deploy();
