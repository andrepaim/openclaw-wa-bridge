#!/usr/bin/env node
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const { createClient } = require('../lib/client');
const { createApp } = require('../lib/server');
const { notifyOpenClaw } = require('../lib/hooks');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3100;
const API_TOKEN = process.env.WA_API_TOKEN || '';
const BASE_DIR = process.env.WA_BRIDGE_DIR || process.cwd();

const HOOK_RULES_FILE = path.join(BASE_DIR, 'hook-rules.json');
let hookRules;
try {
  hookRules = JSON.parse(fs.readFileSync(HOOK_RULES_FILE, 'utf8'));
  console.log('[OC] Loaded hook-rules.json');
} catch (e) {
  console.error(`[OC] FATAL: Cannot load hook-rules.json: ${e.message}`);
  console.error('[OC] Copy hook-rules.json.example to hook-rules.json and configure it.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// WhatsApp Client
// ---------------------------------------------------------------------------
const { client: waClient, state: clientState } = createClient({
  authPath: path.join(BASE_DIR, 'auth'),
  puppeteerCacheDir: process.env.PUPPETEER_CACHE_DIR,
});

// ---------------------------------------------------------------------------
// Express App
// ---------------------------------------------------------------------------
const app = createApp(waClient, clientState, {
  apiToken: API_TOKEN,
  eventsDir: path.join(BASE_DIR, 'events'),
  logsDir: path.join(BASE_DIR, 'logs'),
  monitorsFile: path.join(BASE_DIR, 'monitors.json'),
});

// ---------------------------------------------------------------------------
// Message handler — event queue + OpenClaw hook + monitors
// ---------------------------------------------------------------------------
waClient.on('message', async (msg) => {
  if (!msg || !msg.from) return;
  if (msg.from === 'status@broadcast' || msg.fromMe) return;
  if (hookRules.ignoreIds && hookRules.ignoreIds.includes(msg.from)) return;

  const chat = await msg.getChat().catch(() => null);
  const contact = await msg.getContact().catch(() => null);

  const entry = {
    timestamp: new Date().toISOString(),
    from: msg.from,
    pushName: contact?.pushname || msg._data?.notifyName || null,
    chatName: chat?.name || null,
    author: msg.author || null,
    body: msg.body,
    type: msg.type,
    hasMedia: msg.hasMedia,
    isGroup: chat?.isGroup || false,
  };

  // Write to event queue
  app._eventQueue.push(entry);
  console.log(`[Event] ${entry.pushName || msg.from}: ${(entry.body || '').slice(0, 80)}`);

  // OpenClaw webhook
  notifyOpenClaw(entry, hookRules, PORT);

  // Monitor-specific logic
  const monitors = app._monitors();
  const monitor = monitors[msg.from];
  if (monitor) {
    const logFile = path.join(app._logsDir, `${msg.from.replace(/[^a-zA-Z0-9]/g, '_')}.jsonl`);
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');

    if (monitor.webhook) {
      try {
        const url = new URL(monitor.webhook);
        const payload = JSON.stringify(entry);
        const req = http.request(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        });
        req.on('error', (e) => console.error('[Monitor] Webhook error:', e.message));
        req.end(payload);
      } catch (e) { console.error('[Monitor] Webhook error:', e.message); }
    }

    if (monitor.script?.keywords && msg.body) {
      const lower = msg.body.toLowerCase();
      for (const [keyword, reply] of Object.entries(monitor.script.keywords)) {
        if (lower.includes(keyword.toLowerCase())) {
          try { await msg.reply(reply); } catch (e) { console.error('[Monitor] Auto-reply error:', e.message); }
          break;
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[Server] Listening on 127.0.0.1:${PORT}`);
  console.log('[WA] Initializing client…');
  waClient.initialize().catch(console.error);
});

// Graceful shutdown
async function shutdown(signal) {
  if (clientState.shuttingDown) return;
  clientState.shuttingDown = true;
  console.log(`\n[Server] ${signal} — shutting down…`);
  try { await waClient.destroy(); } catch {}
  server.close(() => { console.log('[Server] Closed'); process.exit(0); });
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
