import { getWatchlist, recordHistory, getHistory } from './storage.mjs';

/**
 * Compares current leaderboard against previous leaderboard snapshot.
 * Generates alert payloads according to the user's specification.
 */

export function analyzeLeaderboardChanges(prevRows, currRows, config) {
  const alerts = [];

  if (!prevRows || prevRows.length === 0) {
    // First run baseline: initialize history without firing spam alerts
    for (const row of currRows) {
      recordHistory(row.name, row.rank, row.score);
    }
    return { alerts, top10Updated: false };
  }

  // Record history for all current rows
  for (const row of currRows) {
    recordHistory(row.name, row.rank, row.score);
  }

  const prevMap = new Map(prevRows.map(r => [r.name.toLowerCase(), r]));
  const currMap = new Map(currRows.map(r => [r.name.toLowerCase(), r]));

  const watchlist = getWatchlist();
  const decreasedUsers = [];
  const increasedUsers = [];

  for (const item of watchlist) {
    const norm = item.omniName.toLowerCase();
    const prev = prevMap.get(norm);
    const curr = currMap.get(norm);

    if (!curr) continue; // Not on leaderboard currently

    if (!prev) {
      // User just appeared on leaderboard for the first time
      continue;
    }

    if (curr.rank > prev.rank) {
      // Rank decreased (e.g. 10 -> 12)
      // Determine who overtook them
      const overtookUsers = currRows.filter(candidate => {
        if (candidate.name.toLowerCase() === norm) return false;
        // Currently ahead of them
        if (candidate.rank >= curr.rank) return false;
        // Was NOT ahead of them previously
        const prevCandidate = prevMap.get(candidate.name.toLowerCase());
        if (!prevCandidate) return true; // Brand new entry jumping ahead
        return prevCandidate.rank >= prev.rank; // Was behind or tied before
      });

      decreasedUsers.push({
        name: curr.name,
        prevRank: prev.rank,
        currRank: curr.rank,
        prevScore: prev.score,
        currScore: curr.score,
        discordUserId: item.discordUserId,
        overtookUsers
      });
    } else if (curr.rank < prev.rank || (curr.rank === prev.rank && curr.score !== prev.score)) {
      // Rank increased (e.g. 3 -> 1) or score improved at same rank
      increasedUsers.push({
        name: curr.name,
        prevRank: prev.rank,
        currRank: curr.rank,
        prevScore: prev.score,
        currScore: curr.score,
        discordUserId: item.discordUserId
      });
    }
  }

  // 1. Process Rank Decreases
  if (decreasedUsers.length === 1) {
    const u = decreasedUsers[0];
    const ping = u.discordUserId ? `<@${u.discordUserId}>` : `@${u.name}`;

    let overtakerLines = 'None identified';
    if (u.overtookUsers.length > 0) {
      overtakerLines = u.overtookUsers.map(o =>
        `🚨${o.name}\nCurrent Position in Order of List: ${o.rank}\nScore: ${o.score}`
      ).join('\n\n');
    }

    const message = [
      '🔻 A user\'s ranking decreased!',
      `User: ${u.name}`,
      `Current Position: ${u.currRank} | Previous: ${u.prevRank}`,
      `Score: ${u.currScore}`,
      '',
      'Got taken over by:',
      overtakerLines,
      ping
    ].join('\n');

    alerts.push({ type: 'DECREASE_SINGLE', content: message });
  } else if (decreasedUsers.length > 1) {
    const userNames = decreasedUsers.map(u => u.name).join(', ');
    const currPositions = decreasedUsers.map(u => u.currRank).join(', ');
    const pings = decreasedUsers.map(u => u.discordUserId ? `<@${u.discordUserId}>` : `@${u.name}`).join(', ');

    // Aggregate unique overtakers
    const allOvertakersMap = new Map();
    for (const u of decreasedUsers) {
      for (const o of u.overtookUsers) {
        if (!allOvertakersMap.has(o.name)) {
          allOvertakersMap.set(o.name, o);
        }
      }
    }
    const overtakers = Array.from(allOvertakersMap.values()).sort((a, b) => a.rank - b.rank);

    const overtakerNames = overtakers.map(o => `🚨${o.name}`).join(', ') || 'None';
    const overtakerPositions = overtakers.map(o => o.rank).join(', ') || 'N/A';
    const overtakerScores = overtakers.map(o => o.score).join(', ') || 'N/A';

    const message = [
      '🔻 Multiple users\' ranking decreased!',
      `Users: ${userNames}`,
      `Current Position in Order of List: [${currPositions}]`,
      '',
      'Got taken over by:',
      `[${overtakerNames}]`,
      `Current Position in Order of List: [${overtakerPositions}]`,
      `Scores in Order of List: [${overtakerScores}]`,
      pings
    ].join('\n');

    alerts.push({ type: 'DECREASE_MULTIPLE', content: message });
  }

  // 2. Process Rank Increases
  for (const u of increasedUsers) {
    const ping = u.discordUserId ? `<@${u.discordUserId}>` : `@${u.name}`;
    const message = [
      '📈 A user\'s ranking increased!',
      `User: ${u.name}`,
      `Current Position: ${u.currRank} | Previous: ${u.prevRank}`,
      `Score: ${u.currScore} | Previous Score: ${u.prevScore}`,
      ping
    ].join('\n');

    alerts.push({ type: 'INCREASE', content: message });
  }

  // 3. Process Top 10 Updates
  const prevTop10 = prevRows.slice(0, 10);
  const currTop10 = currRows.slice(0, 10);

  let top10Changed = false;
  if (prevTop10.length !== currTop10.length) {
    top10Changed = true;
  } else {
    for (let i = 0; i < currTop10.length; i++) {
      if (
        currTop10[i].name !== prevTop10[i].name ||
        currTop10[i].score !== prevTop10[i].score ||
        currTop10[i].rank !== prevTop10[i].rank
      ) {
        top10Changed = true;
        break;
      }
    }
  }

  if (top10Changed) {
    const prevTop10Map = new Map(prevTop10.map(r => [r.name.toLowerCase(), r]));
    const lines = currTop10.map((entry, idx) => {
      const p = prevTop10Map.get(entry.name.toLowerCase());
      let indicator = '';

      if (!p) {
        // Brand new entry into top 10
        indicator = ' ⭐';
      } else if (entry.rank < p.rank) {
        // Climbed up
        indicator = ' 🔺';
      } else if (entry.rank > p.rank) {
        // Dropped down
        indicator = ' 🔻';
      } else if (entry.score !== p.score) {
        indicator = ' 🔺';
      }

      return `${idx + 1}. ${entry.name} | Score: ${entry.score}${indicator}`;
    });

    const ping = config?.discord?.top10Ping || '@everyone';
    const message = [
      '📢NEW TOP 10 UPDATE📢',
      ...lines,
      ping
    ].join('\n');

    alerts.push({ type: 'TOP10_UPDATE', content: message });
  }

  return { alerts, top10Updated: top10Changed };
}

/**
 * Builds the daily recap message at midnight.
 */
export function buildDailyRecap(currRows, lastParticipantCount) {
  const total = currRows.length;
  const growth = total - (lastParticipantCount || total);
  const growthText = growth >= 0 ? `+${growth}` : `${growth}`;

  const top1 = currRows[0] || { name: 'N/A', score: 'N/A' };
  const cutoff = currRows[Math.min(9, currRows.length - 1)] || { score: 'N/A' };

  // Calculate biggest climber from history in the last 24h
  let biggestClimber = null;
  let maxJump = 0;

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  for (const r of currRows) {
    const hist = getHistory(r.name);
    const dayHist = hist.filter(h => h.timestamp >= dayAgo);
    if (dayHist.length >= 2) {
      const oldest = dayHist[0];
      const jump = oldest.rank - r.rank;
      if (jump > maxJump) {
        maxJump = jump;
        biggestClimber = { name: r.name, from: oldest.rank, to: r.rank, jump };
      }
    }
  }

  const climberText = biggestClimber
    ? `🚀 **Climber of the Day:** **${biggestClimber.name}** jumped **+${biggestClimber.jump}** spots (#${biggestClimber.from} ➔ #${biggestClimber.to})!`
    : '🚀 **Climber of the Day:** No major rank shifts recorded today.';

  return [
    '📊 **DAILY LEADERBOARD RECAP**',
    `👥 **Total Participants:** **${total}** (${growthText} in last 24h)`,
    `🥇 **Top Score:** \`${top1.score}\` (held by **${top1.name}**)`,
    `🔟 **Top 10 Cutoff:** \`${cutoff.score}\``,
    climberText
  ].join('\n');
}

/**
 * Builds the auto-updating persistent live dashboard embed.
 */
export function buildDashboardEmbed(currRows, watchlist, lastUpdatedTime) {
  const total = currRows.length;
  const top10 = currRows.slice(0, 10);
  const currMap = new Map(currRows.map(r => [r.name.toLowerCase(), r]));

  const top10Lines = top10.map(r =>
    `\`#${String(r.rank).padEnd(2)}\` **${r.name}** — \`${r.score}\``
  ).join('\n') || 'No entries yet';

  let watchlistLines = 'No users in watchlist yet. Use `/input <name>` to track.';
  if (watchlist.length > 0) {
    watchlistLines = watchlist.map(w => {
      const r = currMap.get(w.omniName.toLowerCase());
      const ping = w.discordUserId ? ` (<@${w.discordUserId}>)` : '';
      if (r) {
        const pct = ((r.rank / total) * 100).toFixed(1);
        return `\`#${String(r.rank).padEnd(2)}\` **${r.name}** — \`${r.score}\` (Top ${pct}%)${ping}`;
      }
      return `\`#--\` **${w.omniName}** — *Unranked*${ping}`;
    }).join('\n');
  }

  const relativeTime = lastUpdatedTime ? `<t:${Math.floor(lastUpdatedTime / 1000)}:R>` : 'Just now';

  return {
    title: '🏆 Omnicampus Live Leaderboard Dashboard',
    color: 0x5865F2,
    fields: [
      {
        name: '🥇 Top 10 Standings',
        value: top10Lines,
        inline: false
      },
      {
        name: '🎯 Watchlist Tracker',
        value: watchlistLines,
        inline: false
      },
      {
        name: '📊 Competition Pulse',
        value: `👥 **Total Participants:** ${total}\n⏱️ **Last Scraped:** ${relativeTime}`,
        inline: false
      }
    ],
    footer: {
      text: 'Auto-refreshed via Chrome DevTools Protocol 24/7'
    },
    timestamp: new Date().toISOString()
  };
}
