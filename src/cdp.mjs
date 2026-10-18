/**
 * Native WebSocket CDP client for scraping Omnicampus leaderboard.
 * Zero npm dependencies (uses native fetch and WebSocket in Node.js 22+).
 */

function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let msgId = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.id && pending.has(data.id)) {
        const { resolve, reject } = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) {
          reject(new Error(`CDP error ${data.error.code}: ${data.error.message}`));
        } else {
          resolve(data.result);
        }
      }
    } catch {
      // Ignore unparseable frames
    }
  };

  const send = (method, params = {}) => {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  const close = () => {
    try {
      ws.close();
    } catch {}
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('WebSocket connection timeout'));
    }, 5000);

    ws.onopen = () => {
      clearTimeout(timer);
      resolve({ send, close });
    };
    ws.onerror = (err) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket connection failed: ${err.message}`));
    };
  });
}

async function evaluate(send, expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  return res && res.result ? res.result.value : null;
}

export async function checkCdpHealth(cdpHost = '127.0.0.1', cdpPort = 9222) {
  try {
    const res = await fetch(`http://${cdpHost}:${cdpPort}/json/version`, {
      signal: AbortSignal.timeout(2000)
    });
    if (res.ok) {
      const data = await res.json();
      return { connected: true, browser: data.Browser || 'Chromium' };
    }
  } catch (err) {
    return { connected: false, error: err.message };
  }
  return { connected: false, error: 'Non-OK HTTP response' };
}

export async function scrapeLeaderboard({
  baseUrl = 'https://edu.omnicamp.us',
  courseId = '170',
  assignmentId = '1038',
  cdpHost = '127.0.0.1',
  cdpPort = 9222
}) {
  const cdpUrl = `http://${cdpHost}:${cdpPort}`;
  const leaderboardUrl = `${baseUrl}/en/courses/${courseId}/assignments/${assignmentId}/leader-board/`;
  const targetSubroute = `assignments/${assignmentId}/leader-board`;

  // 1. Fetch available tabs
  let pages;
  try {
    const res = await fetch(`${cdpUrl}/json`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pages = await res.json();
  } catch (err) {
    throw new Error(`Cannot connect to browser at ${cdpUrl}. Is Chrome running with --remote-debugging-port=${cdpPort}? (${err.message})`);
  }

  // 2. Find or create the target tab
  let targetTab = pages.find(p => p.type === 'page' && p.url && p.url.includes(targetSubroute));

  if (!targetTab) {
    // Check for any omnicampus tab to reuse
    targetTab = pages.find(p => p.type === 'page' && p.url && p.url.includes('omnicamp.us'));
    if (targetTab) {
      // Reuse this tab
    } else {
      // Create new tab
      const createRes = await fetch(`${cdpUrl}/json/new?${encodeURIComponent(leaderboardUrl)}`, { method: 'PUT' });
      targetTab = await createRes.json();
    }
  }

  if (!targetTab || !targetTab.webSocketDebuggerUrl) {
    throw new Error('Failed to acquire a valid browser tab for Omnicampus.');
  }

  // 3. Connect via CDP WebSocket
  const cdp = await createCdpClient(targetTab.webSocketDebuggerUrl);

  try {
    await cdp.send('Page.enable');

    const currentUrl = await evaluate(cdp.send, 'window.location.href');
    if (!currentUrl || !currentUrl.includes(targetSubroute)) {
      await cdp.send('Page.navigate', { url: leaderboardUrl });
    } else {
      // Hard refresh to bypass cache and fetch fresh submission scores
      await cdp.send('Page.reload', { ignoreCache: true });
    }

    // 4. Poll until the table rows populate (up to 20 seconds)
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        ready = await evaluate(cdp.send, `(() => {
          const rows = document.querySelectorAll('tbody tr, table tr');
          return rows.length >= 1;
        })()`);
        if (ready) break;
      } catch {}
      await new Promise(r => setTimeout(r, 500));
    }

    if (!ready) {
      throw new Error('Leaderboard table did not populate within 20s. Please ensure you are logged into Omnicampus.');
    }

    // Brief stabilization pause for full table hydration
    await new Promise(r => setTimeout(r, 500));

    // 5. Extract all rows from DOM
    const rawRows = await evaluate(cdp.send, `(() => {
      const allRows = Array.from(document.querySelectorAll('tbody tr, table tr')).map(r => {
        return Array.from(r.querySelectorAll('th, td')).map(c => c.innerText.trim());
      }).filter(r => r.length >= 3 && /^\\d+$/.test(r[0]));

      return allRows.map(cols => ({
        rank: parseInt(cols[0], 10),
        name: cols[1],
        score: cols[2]
      }));
    })()`);

    if (!rawRows || rawRows.length === 0) {
      throw new Error('Leaderboard rows were not found or format unexpected.');
    }

    // Sort ascending by rank
    rawRows.sort((a, b) => a.rank - b.rank);

    return {
      timestamp: Date.now(),
      totalParticipants: rawRows.length,
      rows: rawRows
    };
  } finally {
    cdp.close();
  }
}
