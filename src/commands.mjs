import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  getHistory,
  getState
} from './storage.mjs';
import { checkCdpHealth } from './cdp.mjs';

export const slashCommands = [
  new SlashCommandBuilder()
    .setName('cmds')
    .setDescription('Display the list of available commands and instructions'),

  new SlashCommandBuilder()
    .setName('input')
    .setDescription('Add a user to the watchlist for automatic leaderboard tracking and alerts')
    .addStringOption(opt =>
      opt.setName('username')
        .setDescription('The Omnicampus username to track')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a user from the watchlist')
    .addStringOption(opt =>
      opt.setName('username')
        .setDescription('The Omnicampus username to remove')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('track')
    .setDescription('Check leaderboard position and score, or compare two users')
    .addStringOption(opt =>
      opt.setName('username')
        .setDescription('Primary username to look up')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('username2')
        .setDescription('Optional second username to compare against')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('neighbor')
    .setDescription('View the competitors directly above and below a user on the leaderboard')
    .addStringOption(opt =>
      opt.setName('username')
        .setDescription('The Omnicampus username to inspect')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('history')
    .setDescription('View the score and rank progression history of a user')
    .addStringOption(opt =>
      opt.setName('username')
        .setDescription('The Omnicampus username')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('Display all currently tracked users, their ranks, and scores'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Display bot health, Chrome CDP connection, and scraping intervals')
];

/**
 * Handles incoming slash command interactions.
 */
export async function handleInteraction(interaction, context) {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const state = getState();
  const rows = state.lastLeaderboard || [];
  const total = rows.length;
  const rowsMap = new Map(rows.map(r => [r.name.toLowerCase(), r]));

  if (commandName === 'cmds') {
    const embed = new EmbedBuilder()
      .setTitle('📖 Omnicampus Leaderboard Bot Commands')
      .setColor(0x5865F2)
      .setDescription('Automated 24/7 tracker and alerts engine via Chrome DevTools Protocol.')
      .addFields(
        { name: '`/input [Username]`', value: 'Adds a username to the watchlist. Stores your Discord ID for pings on rank changes.' },
        { name: '`/remove [Username]`', value: 'Removes a username from the watchlist.' },
        { name: '`/track [Username] [Username2]`', value: 'Shows score & rank for a user, or compares score/rank differences between two users.' },
        { name: '`/neighbor [Username]`', value: 'Shows the competitors immediately above and below the user + point gaps.' },
        { name: '`/watchlist`', value: 'Shows an overview of all tracked users, their positions, and scores.' },
        { name: '`/history [Username]`', value: 'Shows historical score progression and rank improvements over time.' },
        { name: '`/status`', value: 'Checks bot uptime, Chrome connection status, and last scraped time.' },
        { name: '`/cmds`', value: 'Displays this command guide.' }
      )
      .setFooter({ text: 'Simple & Autonomous 24/7 Monitoring' });

    return await interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'input') {
    const username = interaction.options.getString('username').trim();
    addToWatchlist(username, interaction.user.id);

    const onBoard = rowsMap.get(username.toLowerCase());
    let extra = '';
    if (onBoard) {
      extra = `\n🎯 **Current Standings:** Rank \`#${onBoard.rank}/${total}\` with score \`${onBoard.score}\`.`;
    } else {
      extra = `\nℹ️ *Note: This user is not yet on the active leaderboard or has not submitted yet.*`;
    }

    return await interaction.reply({
      content: `✅ Successfully added **${username}** to the watchlist! Alerts will notify <@${interaction.user.id}>.${extra}`
    });
  }

  if (commandName === 'remove') {
    const username = interaction.options.getString('username').trim();
    const removed = removeFromWatchlist(username);

    if (removed) {
      return await interaction.reply({ content: `🗑️ Removed **${username}** from the watchlist.` });
    } else {
      return await interaction.reply({ content: `⚠️ **${username}** was not found in the watchlist.`, ephemeral: true });
    }
  }

  if (commandName === 'track') {
    const user1 = interaction.options.getString('username').trim();
    const user2 = interaction.options.getString('username2')?.trim();

    const data1 = rowsMap.get(user1.toLowerCase());

    if (!user2) {
      // Single user lookup
      if (!data1) {
        return await interaction.reply({
          content: `❌ User **${user1}** was not found on the leaderboard (${total} total participants recorded).`
        });
      }

      const pct = ((data1.rank / total) * 100).toFixed(2);
      const embed = new EmbedBuilder()
        .setTitle(`🎯 Leaderboard Standing: ${data1.name}`)
        .setColor(0x00AE86)
        .addFields(
          { name: 'Position', value: `\`#${data1.rank}\` of ${total}`, inline: true },
          { name: 'Score', value: `\`${data1.score}\``, inline: true },
          { name: 'Percentile', value: `Top ${pct}%`, inline: true }
        )
        .setFooter({ text: `Total Competitors: ${total}` })
        .setTimestamp();

      return await interaction.reply({ embeds: [embed] });
    } else {
      // Comparison between user1 and user2
      const data2 = rowsMap.get(user2.toLowerCase());

      if (!data1 && !data2) {
        return await interaction.reply({ content: `❌ Neither **${user1}** nor **${user2}** were found on the leaderboard.` });
      }
      if (!data1) {
        return await interaction.reply({ content: `❌ User **${user1}** was not found on the leaderboard.` });
      }
      if (!data2) {
        return await interaction.reply({ content: `❌ User **${user2}** was not found on the leaderboard.` });
      }

      const rankDiff = Math.abs(data1.rank - data2.rank);
      const score1 = parseFloat(data1.score) || 0;
      const score2 = parseFloat(data2.score) || 0;
      const scoreDiff = Math.abs(score1 - score2).toFixed(4);

      let leaderText = '';
      if (data1.rank < data2.rank) {
        leaderText = `👑 **${data1.name}** leads by **${rankDiff}** ranks and **+${scoreDiff}** points.`;
      } else if (data2.rank < data1.rank) {
        leaderText = `👑 **${data2.name}** leads by **${rankDiff}** ranks and **+${scoreDiff}** points.`;
      } else {
        leaderText = `🤝 **Tied** at rank \`#${data1.rank}\`!`;
      }

      const embed = new EmbedBuilder()
        .setTitle(`⚔️ Head-to-Head: ${data1.name} vs ${data2.name}`)
        .setColor(0xF1C40F)
        .setDescription(leaderText)
        .addFields(
          { name: data1.name, value: `Rank: \`#${data1.rank}\`\nScore: \`${data1.score}\``, inline: true },
          { name: data2.name, value: `Rank: \`#${data2.rank}\`\nScore: \`${data2.score}\``, inline: true },
          { name: 'Delta', value: `Rank Gap: \`${rankDiff}\`\nScore Gap: \`${scoreDiff}\``, inline: true }
        )
        .setFooter({ text: `Total Competitors: ${total}` })
        .setTimestamp();

      return await interaction.reply({ embeds: [embed] });
    }
  }

  if (commandName === 'neighbor') {
    const username = interaction.options.getString('username').trim();
    const target = rowsMap.get(username.toLowerCase());

    if (!target) {
      return await interaction.reply({ content: `❌ User **${username}** was not found on the leaderboard.` });
    }

    const currentIdx = rows.findIndex(r => r.name.toLowerCase() === username.toLowerCase());
    const above = currentIdx > 0 ? rows[currentIdx - 1] : null;
    const below = currentIdx < rows.length - 1 ? rows[currentIdx + 1] : null;

    const targetScore = parseFloat(target.score) || 0;

    let aboveText = 'None (You are #1! 🥇)';
    if (above) {
      const diff = Math.abs((parseFloat(above.score) || 0) - targetScore).toFixed(4);
      aboveText = `\`#${above.rank}\` **${above.name}** | Score: \`${above.score}\` *(+${diff} to overtake)*`;
    }

    let belowText = 'None (Lowest position on board)';
    if (below) {
      const diff = Math.abs(targetScore - (parseFloat(below.score) || 0)).toFixed(4);
      belowText = `\`#${below.rank}\` **${below.name}** | Score: \`${below.score}\` *(+${diff} buffer)*`;
    }

    const embed = new EmbedBuilder()
      .setTitle(`🔍 Neighbor Analysis: ${target.name}`)
      .setColor(0x3498DB)
      .addFields(
        { name: '⬆️ Ahead (Above)', value: aboveText, inline: false },
        { name: '🎯 Target', value: `\`#${target.rank}\` **${target.name}** | Score: \`${target.score}\``, inline: false },
        { name: '⬇️ Behind (Below)', value: belowText, inline: false }
      )
      .setFooter({ text: `Total Competitors: ${total}` })
      .setTimestamp();

    return await interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'history') {
    const username = interaction.options.getString('username').trim();
    const history = getHistory(username);

    if (!history || history.length === 0) {
      return await interaction.reply({
        content: `ℹ️ No historical progression recorded for **${username}** yet. Progression is recorded automatically as score changes occur.`
      });
    }

    const lines = history.slice(-15).reverse().map(h => {
      const date = new Date(h.timestamp).toLocaleString();
      return `• \`${date}\` ➔ Rank \`#${h.rank}\` | Score: \`${h.score}\``;
    });

    const embed = new EmbedBuilder()
      .setTitle(`📜 Score & Rank History: ${username}`)
      .setColor(0x9B59B6)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Showing last ${Math.min(15, history.length)} recorded milestones` });

    return await interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'watchlist') {
    const watchlist = getWatchlist();

    if (watchlist.length === 0) {
      return await interaction.reply({
        content: 'ℹ️ The watchlist is currently empty. Use `/input <username>` to add someone!'
      });
    }

    const lines = watchlist.map(item => {
      const r = rowsMap.get(item.omniName.toLowerCase());
      const userTag = item.discordUserId ? `<@${item.discordUserId}>` : 'Unassigned';
      if (r) {
        const pct = ((r.rank / total) * 100).toFixed(1);
        return `\`#${String(r.rank).padEnd(2)}\` **${r.name}** — \`${r.score}\` *(Top ${pct}%)* | Added by: ${userTag}`;
      }
      return `\`#--\` **${item.omniName}** — *Unranked* | Added by: ${userTag}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`🎯 Active Watchlist (${watchlist.length} users)`)
      .setColor(0x5865F2)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Total Participants: ${total}` })
      .setTimestamp();

    return await interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'status') {
    const health = await checkCdpHealth(context.config.omnicampus.cdpHost, context.config.omnicampus.cdpPort);
    const uptimeSec = Math.floor(process.uptime());
    const uptimeStr = `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m ${uptimeSec % 60}s`;

    const lastScrape = state.lastScrapeTime
      ? `<t:${Math.floor(state.lastScrapeTime / 1000)}:R>`
      : 'Never';

    const nextScrape = context.nextScrapeTime
      ? `<t:${Math.floor(context.nextScrapeTime / 1000)}:R>`
      : 'In progress';

    const embed = new EmbedBuilder()
      .setTitle('🖥️ Omnicampus Bot Status & Health')
      .setColor(health.connected ? 0x2ECC71 : 0xE74C3C)
      .addFields(
        { name: 'CDP Chrome Status', value: health.connected ? `✅ Connected (${health.browser})` : `❌ Disconnected (${health.error})`, inline: true },
        { name: 'Bot Uptime', value: `⏱️ ${uptimeStr}`, inline: true },
        { name: 'Last Scraped', value: lastScrape, inline: true },
        { name: 'Next Scheduled Scrape', value: nextScrape, inline: true },
        { name: 'Current Total Competitors', value: `👥 ${total}`, inline: true },
        { name: 'Watchlist Count', value: `🎯 ${getWatchlist().length}`, inline: true }
      )
      .setFooter({ text: `Polling every ~${Math.round(context.config.polling.intervalSeconds / 60)} minutes with jitter` })
      .setTimestamp();

    return await interaction.reply({ embeds: [embed] });
  }
}
