# 🏆 Omnicampus Discord Leaderboard Bot

Autonomous 24/7 Discord bot that scrapes and tracks live competition leaderboards on [Omnicampus](https://edu.omnicamp.us) using native Chrome DevTools Protocol (CDP).

---

## ⚡ Features

* **Real Browser CDP Scraping**: Reuses your authentic, logged-in Chrome session via remote debugging (port 9222). Bypasses bot detection, Cloudflare, CAPTCHAs, and session timeouts.
* **Smart Alert Engine**:
  * 🔻 **Single & Batch Rank Decreases**: Identifies exactly who overtook whom and tags the affected users (`@User`).
  * 📈 **Rank & Score Increases**: Broadcasts score bumps and rank advancements with historical deltas.
  * 📢 **Top 10 Updates**: Live top 10 snapshot with indicators (`⭐` new entrant, `🔺` climbed, `🔻` dropped) with `@everyone` announcement.
  * 📊 **Daily Midnight Recap**: Automated summary at 00:00 showing participant growth, top score, cutoff, and **Climber of the Day**.
* **Live Dashboard Channel**: Optional sticky, auto-updating leaderboard and watchlist status board that updates in-place without chat spam.
* **Interactive Slash Commands**:
  * `/cmds` — Shows command guide and instructions.
  * `/input [Username]` — Adds a user to the watchlist and registers your Discord ID for pings.
  * `/remove [Username]` — Removes a user from the watchlist.
  * `/track [Username] [Username2]` — Checks a user's stats or compares score/rank head-to-head.
  * `/neighbor [Username]` — Inspects the competitors immediately ahead and behind + point gaps.
  * `/history [Username]` — Displays historical score progression and rank milestones.
  * `/watchlist` — Summarizes all tracked users, their ranks, scores, and percentile.
  * `/status` — Displays bot uptime, Chrome connection health, and scrape timers.
* **Anti-Detection Jitter**: Adds randomized variance (e.g. 5 minutes $\pm$ 30s) to mimic human browsing behavior.

---

## 🚀 Setup Guide

### 1. Create Your Discord Bot
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a **New Application**.
2. Go to the **Bot** tab:
   * Click **Reset Token** and copy your **Bot Token**.
   * Under **Privileged Gateway Intents**, enable:
     * ✅ **Message Content Intent** (optional, recommended)
     * ✅ **Server Members Intent** (optional)
3. Go to **OAuth2 ➔ URL Generator**:
   * Scopes: `bot`, `applications.commands`
   * Bot Permissions: `Send Messages`, `Embed Links`, `Mention Everyone`, `Use External Emojis`, `Read Message History`.
   * Open the generated URL in your browser to invite the bot to your Discord server.
4. In Discord, turn on **Developer Mode** (User Settings ➔ Advanced ➔ Developer Mode), right-click your target channels and copy their IDs:
   * **Alerts Channel ID**: Where rank change pings and top 10 announcements are posted.
   * **Dashboard Channel ID** (optional): A dedicated channel where the bot keeps a single auto-updating scoreboard.

---

### 2. Configure the Bot

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Edit `.env`:
```env
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_application_client_id_here
DISCORD_GUILD_ID=your_server_id_here  # Optional: speeds up slash command sync
```

Edit `config.json`:
```json
{
  "omnicampus": {
    "baseUrl": "https://edu.omnicamp.us",
    "courseId": "170",
    "assignmentId": "1038",
    "cdpHost": "127.0.0.1",
    "cdpPort": 9222
  },
  "polling": {
    "intervalSeconds": 300,
    "jitterSeconds": 30
  },
  "discord": {
    "alertsChannelId": "123456789012345678",
    "dashboardChannelId": "123456789012345678",
    "top10Ping": "@everyone",
    "enableDailyRecap": true,
    "recapHour": 0
  }
}
```

---

### 3. Deploy Slash Commands

Register the slash commands with Discord:
```bash
npm run deploy-commands
```

---

### 4. Running Brave or Chrome with Remote Debugging

Make sure existing instances of your browser are closed, then launch with `--remote-debugging-port=9222`:

#### Brave (Recommended)
**Windows (PowerShell / Command Prompt):**
```powershell
& "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" --remote-debugging-port=9222 --remote-allow-origins=*
```
*(Or if `brave.exe` is in your PATH, just `brave.exe --remote-debugging-port=9222 --remote-allow-origins=*`)*

#### Google Chrome
**Windows:**
```powershell
chrome.exe --remote-debugging-port=9222 --remote-allow-origins=*
```

*Log into your Omnicampus account in that browser window so your session cookies are active.*

---

### 5. Launch the Bot

Simply double-click `start.bat` (which **auto-detects Brave** first, launches it if not already open, and boots the bot) or run:
```bash
npm start
```

---

## 💻 24/7 Spare Laptop Setup (Windows)

To keep the laptop running 24/7 without sleeping or disconnecting:
1. **Lid Action**: Open Windows Settings ➔ *Control Panel* ➔ *Power Options* ➔ *Choose what closing the lid does* ➔ Set to **"Do nothing"** when plugged in.
2. **Sleep Settings**: Settings ➔ *System* ➔ *Power & Sleep* ➔ Set *Sleep* to **"Never"** when plugged in.
3. **Auto-Restart on Reboot (PM2)**:
   You can install PM2 to restart the bot automatically:
   ```bash
   npm install -g pm2
   pm2 start src/index.mjs --name "omni-bot"
   pm2 save
   ```

---

## 📁 Project Structure

```text
omnicampus-discord-bot/
├── config.json          # Polling intervals, course IDs, channel IDs
├── .env                 # Discord credentials
├── start.bat            # 1-click Windows runner
├── data/
│   ├── watchlist.json   # Tracked users and linked Discord IDs
│   ├── state.json       # Previous rankings snapshot and message IDs
│   └── history.json     # Score and rank progression milestones
└── src/
    ├── cdp.mjs          # Native WebSocket CDP browser scraper
    ├── storage.mjs      # JSON file persistence
    ├── alertEngine.mjs  # Overtake detection, batch drops, top 10 logic
    ├── commands.mjs     # Slash command definitions and execution
    ├── deployCommands.mjs # Slash command registrar
    └── index.mjs        # Bot startup, Discord client, and polling loop
```
