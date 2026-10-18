import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const WATCHLIST_PATH = path.join(DATA_DIR, 'watchlist.json');
const STATE_PATH = path.join(DATA_DIR, 'state.json');
const HISTORY_PATH = path.join(DATA_DIR, 'history.json');

function readJson(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error(`[Storage] Error reading ${filePath}:`, err.message);
  }
  return defaultValue;
}

function writeJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`[Storage] Error writing ${filePath}:`, err.message);
  }
}

// --- Watchlist Management ---
export function getWatchlist() {
  return readJson(WATCHLIST_PATH, []);
}

export function addToWatchlist(omniName, discordUserId) {
  const list = getWatchlist();
  const normalized = omniName.trim().toLowerCase();
  const existingIdx = list.findIndex(item => item.omniName.toLowerCase() === normalized);

  if (existingIdx !== -1) {
    // Update user link if already present
    list[existingIdx].discordUserId = discordUserId;
    list[existingIdx].updatedAt = Date.now();
  } else {
    list.push({
      omniName: omniName.trim(),
      discordUserId,
      addedAt: Date.now()
    });
  }
  writeJson(WATCHLIST_PATH, list);
  return list;
}

export function removeFromWatchlist(omniName) {
  const list = getWatchlist();
  const normalized = omniName.trim().toLowerCase();
  const filtered = list.filter(item => item.omniName.toLowerCase() !== normalized);
  const removed = list.length !== filtered.length;
  if (removed) {
    writeJson(WATCHLIST_PATH, filtered);
  }
  return removed;
}

export function getWatchlistEntry(omniName) {
  const list = getWatchlist();
  const normalized = omniName.trim().toLowerCase();
  return list.find(item => item.omniName.toLowerCase() === normalized) || null;
}

// --- History Management ---
export function getHistory(omniName) {
  const allHistory = readJson(HISTORY_PATH, {});
  const normalized = omniName.trim().toLowerCase();
  return allHistory[normalized] || [];
}

export function recordHistory(omniName, rank, score) {
  const allHistory = readJson(HISTORY_PATH, {});
  const normalized = omniName.trim().toLowerCase();
  if (!allHistory[normalized]) {
    allHistory[normalized] = [];
  }

  const list = allHistory[normalized];
  const lastEntry = list[list.length - 1];

  // Only append if rank or score actually changed
  if (!lastEntry || lastEntry.rank !== rank || lastEntry.score !== score) {
    list.push({
      timestamp: Date.now(),
      rank,
      score
    });
    // Keep up to 100 historical snapshots per user
    if (list.length > 100) {
      allHistory[normalized] = list.slice(-100);
    }
    writeJson(HISTORY_PATH, allHistory);
  }
}

// --- State Management ---
export function getState() {
  return readJson(STATE_PATH, {
    lastLeaderboard: [],
    lastScrapeTime: null,
    lastParticipantCount: 0,
    lastRecapDate: null,
    dashboardMessageId: null
  });
}

export function saveState(updates) {
  const current = getState();
  const newState = { ...current, ...updates };
  writeJson(STATE_PATH, newState);
  return newState;
}
