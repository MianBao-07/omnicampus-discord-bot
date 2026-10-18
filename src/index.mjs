import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, GatewayIntentBits } from 'discord.js';
import { scrapeLeaderboard } from './cdp.mjs';
import { getState, saveState, getWatchlist } from './storage.mjs';
import {
  analyzeLeaderboardChanges,
  buildDailyRecap,
  buildDashboardEmbed
} from './alertEngine.mjs';
import { handleInteraction } from './commands.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT_DIR, '.env');
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');

// Load environment variables
if (fs.existsSync(ENV_PATH) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(ENV_PATH);
  } catch {}
}

// Load config
let config = {};
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (err) {
  console.error('[Error] Failed to read config.json:', err.message);
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

const context = {
  config,
  nextScrapeTime: null,
  consecutiveErrors: 0
};

// Global error guards to keep the bot alive 24/7
client.on('error', (err) => {
  console.error('[Discord Client Error]:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]:', reason);
});

client.on('interactionCreate', async (interaction) => {
  try {
    await handleInteraction(interaction, context);
  } catch (err) {
    console.error('[Interaction] Error handling interaction:', err.message);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: 'An error occurred while executing this command.' });
      } else {
        await interaction.reply({ content: 'An error occurred while executing this command.' });
      }
    } catch {
      // Ignore if the interaction token has already expired on Discord's side
    }
  }
});

/**
 * Checks and triggers the daily midnight recap if due.
 */
async function checkDailyRecap(currRows, alertsChannel) {
  if (!config.discord?.enableDailyRecap || !alertsChannel) return;

  const now = new Date();
  const recapHour = config.discord?.recapHour ?? 0;
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const state = getState();
  if (now.getHours() === recapHour && state.lastRecapDate !== todayStr) {
    console.log('[Recap] Triggering daily midnight recap...');
    const recapMessage = buildDailyRecap(currRows, state.lastParticipantCount);
    await alertsChannel.send({ content: recapMessage });
    saveState({
      lastRecapDate: todayStr,
      lastParticipantCount: currRows.length
    });
  }
}

/**
 * Main scraping and alert loop.
 */
async function runScrapeCycle() {
  const alertsChannelId = config.discord?.alertsChannelId;
  let alertsChannel = null;

  if (alertsChannelId && alertsChannelId !== 'YOUR_ALERTS_CHANNEL_ID') {
    try {
      alertsChannel = await client.channels.fetch(alertsChannelId);
    } catch (err) {
      console.warn(`[Alerts] Unable to fetch alerts channel (${alertsChannelId}):`, err.message);
    }
  }

  try {
    console.log(`[Scraper] Starting scrape cycle for Course ${config.omnicampus.courseId}, Assignment ${config.omnicampus.assignmentId}...`);
    const scraped = await scrapeLeaderboard(config.omnicampus);
    context.consecutiveErrors = 0;

    const state = getState();
    const prevRows = state.lastLeaderboard || [];
    const currRows = scraped.rows;

    console.log(`[Scraper] Scraped ${currRows.length} participants successfully.`);

    // Analyze rank/score shifts and top 10 changes
    const { alerts } = analyzeLeaderboardChanges(prevRows, currRows, config);

    // Send alerts if detected
    if (alerts.length > 0 && alertsChannel) {
      for (const alert of alerts) {
        console.log(`[Alert] Dispatching ${alert.type}...`);
        await alertsChannel.send({ content: alert.content });
      }
    }

    // Check daily midnight recap
    await checkDailyRecap(currRows, alertsChannel);

    // Save state
    saveState({
      lastLeaderboard: currRows,
      lastScrapeTime: scraped.timestamp,
      lastParticipantCount: state.lastParticipantCount || currRows.length
    });

  } catch (err) {
    context.consecutiveErrors++;
    console.error(`[Scraper] Cycle failed (Attempt ${context.consecutiveErrors}):`, err.message);

    // If Chrome or network fails for 3 consecutive cycles, notify the channel once
    if (context.consecutiveErrors === 3 && alertsChannel) {
      await alertsChannel.send({
        content: `⚠️ **Warning:** Leaderboard scraper encountered 3 consecutive errors:\n\`${err.message}\`\nPlease check Chrome remote debugging on the host laptop.`
      }).catch(() => {});
    }
  }

  // Schedule next run with human jitter
  const baseInterval = config.polling?.intervalSeconds || 300;
  const jitter = config.polling?.jitterSeconds || 30;
  const variance = (Math.random() * 2 - 1) * jitter;
  const finalWaitSec = Math.max(30, Math.round(baseInterval + variance));

  context.nextScrapeTime = Date.now() + (finalWaitSec * 1000);
  console.log(`[Scraper] Next scrape in ${finalWaitSec}s (${new Date(context.nextScrapeTime).toLocaleTimeString()})\n`);

  setTimeout(runScrapeCycle, finalWaitSec * 1000);
}

client.once('ready', () => {
  console.log(`========================================`);
  console.log(` Omnicampus Discord Bot is Online!`);
  console.log(` Logged in as: ${client.user.tag}`);
  console.log(` Alerts Channel: ${config.discord.alertsChannelId}`);
  console.log(` Polling Interval: ~${Math.round((config.polling?.intervalSeconds || 300) / 60)} minutes`);
  console.log(`========================================\n`);

  // Start polling cycle immediately upon client ready
  runScrapeCycle();
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('[Error] DISCORD_TOKEN is missing in .env file. Please configure .env before starting.');
  process.exit(1);
}

client.login(token).catch(err => {
  console.error('[Error] Discord login failed:', err.message);
  process.exit(1);
});
