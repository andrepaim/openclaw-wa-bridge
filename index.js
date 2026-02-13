#!/usr/bin/env node
'use strict';

require('dotenv').config();
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3100;
const API_TOKEN = process.env.WA_API_TOKEN || '';
const MONITORS_FILE = path.join(__dirname, 'monitors.json');
const LOGS_DIR = path.join(__dirname, 'logs');

// Telegram instant notification
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || '';
const TG_CHAT_ID = process.env.TG_CHAT_ID || '';

process.env.PUPPETEER_CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || '/home/andrepaim/.cache/puppeteer';

// Ensure dirs
fs.mkdirSync(LOGS_DIR, { recursive: true });
fs.mkdirSync(path.join(__dirname, 'auth'), { recursive: true });

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentQR = null;       // latest QR string (null when authenticated)
let clientReady = false;
let clientInfo = null;
let shuttingDown = false;

// ---------------------------------------------------------------------------
// Monitors persistence
// ---------------------------------------------------------------------------
function loadMonitors() {
  try {
    return JSON.parse(fs.readFileSync(MONITORS_FILE, 'utf8'));
  } catch { return {}; }
}
function saveMonitors(m) {
  fs.writeFileSync(MONITORS_FILE, JSON.stringify(m, null, 2));
}
let monitors = loadMonitors();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Normalise a chat id – append @c.us or @g.us if missing */
function normaliseChatId(id, group = false) {
  if (!id) return id;
  id = String(id).trim();
  if (id.includes('@')) return id;
  return group ? `${id}@g.us` : `${id}@c.us`;
}

function errorResponse(res, status, message) {
  return res.status(status).json({ error: message });
}

function requireConnected(res) {
  if (!clientReady) {
    errorResponse(res, 503, 'WhatsApp client is not connected');
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// WhatsApp Client
// ---------------------------------------------------------------------------
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, 'auth') }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  },
});

client.on('qr', (qr) => {
  currentQR = qr;
  qrcodeTerminal.generate(qr, { small: true });
  console.log('[WA] QR code received – scan with WhatsApp');
});

client.on('ready', () => {
  clientReady = true;
  currentQR = null;
  clientInfo = client.info;
  console.log('[WA] Client ready –', clientInfo?.pushname || 'unknown');
});

client.on('authenticated', () => {
  currentQR = null;
  console.log('[WA] Authenticated');
});

client.on('auth_failure', (msg) => {
  console.error('[WA] Auth failure:', msg);
});

client.on('disconnected', (reason) => {
  clientReady = false;
  clientInfo = null;
  console.warn('[WA] Disconnected:', reason);
  if (!shuttingDown) {
    console.log('[WA] Attempting reconnect in 5s…');
    setTimeout(() => { if (!shuttingDown) client.initialize().catch(console.error); }, 5000);
  }
});

// ---------------------------------------------------------------------------
// OpenClaw webhook — load routing rules from hook-rules.json
// ---------------------------------------------------------------------------
const HOOK_RULES_FILE = path.join(__dirname, 'hook-rules.json');
let hookRules;
try {
  hookRules = JSON.parse(fs.readFileSync(HOOK_RULES_FILE, 'utf8'));
  console.log('[OC] Loaded hook-rules.json');
} catch (e) {
  console.error(`[OC] FATAL: Cannot load hook-rules.json: ${e.message}`);
  console.error('[OC] Copy hook-rules.json.example to hook-rules.json and configure it.');
  process.exit(1);
}

function buildContactDirectory(categories) {
  const lines = [];
  for (const [name, cat] of Object.entries(categories)) {
    lines.push(`${name.toUpperCase()}:`);
    if (cat.ids && cat.ids.length) cat.ids.forEach(id => lines.push(`  - ${id}`));
    if (cat.matchName) lines.push(`  - (match contact name: ${cat.matchName})`);
    if (cat.context) lines.push(`  Context: ${cat.context}`);
  }
  return lines.join('\n');
}

function buildRoutingRules(categories, defaults, tgChatId) {
  const lines = [];
  let i = 1;
  for (const [name, cat] of Object.entries(categories)) {
    const actionDesc = cat.action === 'reply-and-notify'
      ? `Reply on WhatsApp (style: ${cat.style || 'default'}). ALWAYS notify on Telegram after.`
      : cat.action === 'notify-only'
      ? 'Do NOT reply on WhatsApp. Notify on Telegram with a brief summary.'
      : `Action: ${cat.action}`;
    lines.push(`${i}. ${name.toUpperCase()}: ${actionDesc}`);
    i++;
  }
  if (defaults.groups?.action === 'ignore') {
    lines.push(`${i}. GROUPS (isGroup=true): Do NOT reply. Do NOT notify. Reply NO_REPLY.`);
    i++;
  }
  if (defaults.unknown?.action === 'notify-only') {
    lines.push(`${i}. SPAM / UNKNOWN / PROMOTIONAL: Do NOT reply on WhatsApp. Notify on Telegram with a brief summary.`);
    i++;
  }
  lines.push('');
  lines.push(`== HOW TO NOTIFY ON TELEGRAM ==`);
  lines.push(`Use the message tool: action=send, channel=telegram, target=${tgChatId}, message=your summary`);
  return lines.join('\n');
}

async function notifyOpenClaw(entry) {
  try {
    const sender = entry.pushName || entry.from.replace('@c.us', '').replace('@g.us', '');
    const group = entry.isGroup ? ` (grupo: ${entry.chatName || '?'})` : '';
    const body = (entry.body || '[mídia]').slice(0, 1000);
    const waId = entry.from;
    const { categories, defaults } = hookRules.contacts;
    const tgChatId = hookRules.telegram.chatId;

    const message = [
      `📱 WhatsApp message received:`,
      `From: ${sender}${group}`,
      `WA ID: ${waId}`,
      `Type: ${entry.type || 'chat'}`,
      entry.hasMedia ? `Has media: yes` : null,
      ``,
      `Message: ${body}`,
      ``,
      `== CONTACT DIRECTORY ==`,
      buildContactDirectory(categories),
      ``,
      `== ROUTING RULES ==`,
      buildRoutingRules(categories, defaults, tgChatId),
      ``,
      `== HOW TO REPLY ON WHATSAPP ==`,
      `curl -s -X POST http://127.0.0.1:3100/send -H 'Content-Type: application/json' -d '{"to":"${waId}","message":"YOUR_REPLY"}'`,
    ].filter(Boolean).join('\n');

    const payload = JSON.stringify({
      message,
      name: 'WhatsApp',
      sessionKey: `hook:wa:${waId}`,
      wakeMode: 'now',
      deliver: false,
      timeoutSeconds: 120,
    });

    const req = http.request(hookRules.openclaw.hookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${hookRules.openclaw.hookToken}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    });
    req.on('error', (e) => console.error('[OC] Hook error:', e.message));
    req.end(payload);
    console.log(`[OC] Hook sent: ${sender} → "${body.slice(0, 60)}"`);
  } catch (e) { console.error('[OC] Hook error:', e.message); }
}

// ---------------------------------------------------------------------------
// Event queue for OpenClaw integration
// ---------------------------------------------------------------------------
const EVENTS_DIR = path.join(__dirname, 'events');
const EVENTS_FILE = path.join(EVENTS_DIR, 'incoming.jsonl');
fs.mkdirSync(EVENTS_DIR, { recursive: true });

// Monitor incoming messages
client.on('message', async (msg) => {
  if (!msg || !msg.from) return;
  // Skip status broadcasts, own messages, and Andre's own numbers
  if (msg.from === 'status@broadcast' || msg.fromMe) return;
  // Only skip the bridge's own number (to avoid echo loops)
  if (hookRules.ignoreIds.includes(msg.from)) return;

  const contactId = msg.from;
  const chat = await msg.getChat().catch(() => null);
  const contact = await msg.getContact().catch(() => null);

  const entry = {
    timestamp: new Date().toISOString(),
    from: contactId,
    pushName: contact?.pushname || msg._data?.notifyName || null,
    chatName: chat?.name || null,
    author: msg.author || null,
    body: msg.body,
    type: msg.type,
    hasMedia: msg.hasMedia,
    isGroup: chat?.isGroup || false,
  };

  // Always write to events file for OpenClaw to pick up
  fs.appendFileSync(EVENTS_FILE, JSON.stringify(entry) + '\n');
  console.log(`[Event] New message from ${entry.pushName || contactId}: ${(entry.body || '').slice(0, 80)}`);

  // Instant OpenClaw webhook notification
  notifyOpenClaw(entry);

  // Monitor-specific logic
  const monitor = monitors[contactId];
  if (monitor) {
    // Log to monitor-specific file
    const logFile = path.join(LOGS_DIR, `${contactId.replace(/[^a-zA-Z0-9]/g, '_')}.jsonl`);
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');

    // Webhook
    if (monitor.webhook) {
      try {
        const url = new URL(monitor.webhook);
        const payload = JSON.stringify(entry);
        const req = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } });
        req.on('error', (e) => console.error('[Monitor] Webhook error:', e.message));
        req.end(payload);
      } catch (e) { console.error('[Monitor] Webhook error:', e.message); }
    }

    // Keyword auto-reply
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
// Express App
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());

// Auth middleware
app.use((req, res, next) => {
  if (!API_TOKEN) return next();
  const auth = req.headers.authorization;
  if (auth === `Bearer ${API_TOKEN}`) return next();
  return errorResponse(res, 401, 'Unauthorized');
});

// ---- Connection -----------------------------------------------------------

app.get('/status', (_req, res) => {
  res.json({
    status: clientReady ? 'connected' : (currentQR ? 'waiting_for_qr' : 'disconnected'),
    info: clientInfo ? { pushname: clientInfo.pushname, wid: clientInfo.wid?._serialized, platform: clientInfo.platform } : null,
  });
});

app.get('/qr', async (_req, res) => {
  if (!currentQR) return res.json({ qr: null, message: clientReady ? 'Already authenticated' : 'No QR available yet' });
  try {
    const base64 = await QRCode.toDataURL(currentQR);
    res.json({ qr: currentQR, base64 });
  } catch (e) { errorResponse(res, 500, e.message); }
});

// ---- Events (OpenClaw integration) ----------------------------------------

/** GET /events — Read and flush pending incoming message events */
app.get('/events', (_req, res) => {
  try {
    if (!fs.existsSync(EVENTS_FILE)) return res.json([]);
    const raw = fs.readFileSync(EVENTS_FILE, 'utf8').trim();
    if (!raw) return res.json([]);
    const events = raw.split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    // Flush the file after reading
    fs.writeFileSync(EVENTS_FILE, '');
    res.json(events);
  } catch (e) { errorResponse(res, 500, e.message); }
});

/** GET /events/peek — Read without flushing */
app.get('/events/peek', (_req, res) => {
  try {
    if (!fs.existsSync(EVENTS_FILE)) return res.json([]);
    const raw = fs.readFileSync(EVENTS_FILE, 'utf8').trim();
    if (!raw) return res.json([]);
    const events = raw.split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    res.json(events);
  } catch (e) { errorResponse(res, 500, e.message); }
});

// ---- Chats ----------------------------------------------------------------

app.get('/chats', async (_req, res) => {
  if (!requireConnected(res)) return;
  try {
    const chats = await client.getChats();
    res.json(chats.map(c => ({
      id: c.id._serialized,
      name: c.name,
      isGroup: c.isGroup,
      unreadCount: c.unreadCount,
      timestamp: c.timestamp,
      lastMessage: c.lastMessage ? { body: c.lastMessage.body?.substring(0, 100), fromMe: c.lastMessage.fromMe } : null,
    })));
  } catch (e) { errorResponse(res, 500, e.message); }
});

app.get('/chats/:chatId/messages', async (req, res) => {
  if (!requireConnected(res)) return;
  try {
    const chatId = normaliseChatId(req.params.chatId, req.params.chatId.includes('g.us'));
    const chat = await client.getChatById(chatId);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const messages = await chat.fetchMessages({ limit });
    res.json(messages.map(m => ({
      id: m.id._serialized,
      from: m.from,
      author: m.author || null,
      body: m.body,
      timestamp: m.timestamp,
      fromMe: m.fromMe,
      hasMedia: m.hasMedia,
      type: m.type,
    })));
  } catch (e) { errorResponse(res, 500, e.message); }
});

// ---- Contacts -------------------------------------------------------------

app.get('/contacts', async (_req, res) => {
  if (!requireConnected(res)) return;
  try {
    const contacts = await client.getContacts();
    res.json(contacts.map(c => ({
      id: c.id._serialized,
      name: c.name || c.pushname || null,
      number: c.number,
      isMyContact: c.isMyContact,
      isGroup: c.isGroup,
    })));
  } catch (e) { errorResponse(res, 500, e.message); }
});

app.get('/contacts/search', async (req, res) => {
  if (!requireConnected(res)) return;
  const q = (req.query.q || '').toLowerCase();
  if (!q) return errorResponse(res, 400, 'Missing query parameter q');
  try {
    const contacts = await client.getContacts();
    const matches = contacts.filter(c => {
      const name = (c.name || c.pushname || '').toLowerCase();
      return name.includes(q);
    });
    res.json(matches.map(c => ({
      id: c.id._serialized,
      name: c.name || c.pushname || null,
      number: c.number,
      isMyContact: c.isMyContact,
    })));
  } catch (e) { errorResponse(res, 500, e.message); }
});

// ---- Groups ---------------------------------------------------------------

app.get('/groups', async (_req, res) => {
  if (!requireConnected(res)) return;
  try {
    const chats = await client.getChats();
    res.json(chats.filter(c => c.isGroup).map(c => ({
      id: c.id._serialized,
      name: c.name,
      participants: c.groupMetadata?.participants?.length || null,
    })));
  } catch (e) { errorResponse(res, 500, e.message); }
});

app.get('/groups/search', async (req, res) => {
  if (!requireConnected(res)) return;
  const q = (req.query.q || '').toLowerCase();
  if (!q) return errorResponse(res, 400, 'Missing query parameter q');
  try {
    const chats = await client.getChats();
    const groups = chats.filter(c => c.isGroup && c.name.toLowerCase().includes(q));
    res.json(groups.map(c => ({ id: c.id._serialized, name: c.name })));
  } catch (e) { errorResponse(res, 500, e.message); }
});

app.get('/groups/:groupId/info', async (req, res) => {
  if (!requireConnected(res)) return;
  try {
    const gid = normaliseChatId(req.params.groupId, true);
    const chat = await client.getChatById(gid);
    if (!chat.isGroup) return errorResponse(res, 400, 'Not a group chat');
    const meta = chat.groupMetadata;
    res.json({
      id: chat.id._serialized,
      name: chat.name,
      description: meta?.desc || null,
      participants: meta?.participants?.map(p => ({ id: p.id._serialized, isAdmin: p.isAdmin, isSuperAdmin: p.isSuperAdmin })) || [],
      createdAt: meta?.creation || null,
    });
  } catch (e) { errorResponse(res, 500, e.message); }
});

// ---- Messaging ------------------------------------------------------------

app.post('/send', async (req, res) => {
  if (!requireConnected(res)) return;
  const { to, message } = req.body || {};
  if (!to || !message) return errorResponse(res, 400, 'Missing required fields: to, message');
  try {
    const chatId = normaliseChatId(to);
    const sent = await client.sendMessage(chatId, message);
    res.json({ success: true, messageId: sent.id._serialized, to: chatId });
  } catch (e) { errorResponse(res, 500, e.message); }
});

app.post('/send-group', async (req, res) => {
  if (!requireConnected(res)) return;
  const { groupId, message } = req.body || {};
  if (!groupId || !message) return errorResponse(res, 400, 'Missing required fields: groupId, message');
  try {
    const gid = normaliseChatId(groupId, true);
    const sent = await client.sendMessage(gid, message);
    res.json({ success: true, messageId: sent.id._serialized, to: gid });
  } catch (e) { errorResponse(res, 500, e.message); }
});

// ---- Search ---------------------------------------------------------------

app.get('/search', async (req, res) => {
  if (!requireConnected(res)) return;
  const q = req.query.q;
  if (!q) return errorResponse(res, 400, 'Missing query parameter q');
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  try {
    const options = { limit };
    if (req.query.chatId) options.chatId = normaliseChatId(req.query.chatId, req.query.chatId.includes('g.us'));
    const messages = await client.searchMessages(q, options);
    res.json(messages.map(m => ({
      id: m.id._serialized,
      from: m.from,
      author: m.author || null,
      body: m.body,
      timestamp: m.timestamp,
      chatName: m.chat?.name || null,
    })));
  } catch (e) { errorResponse(res, 500, e.message); }
});

// ---- Media ----------------------------------------------------------------

app.get('/messages/:messageId/media', async (req, res) => {
  if (!requireConnected(res)) return;
  // messageId is the _serialized id – we need to find the message
  // whatsapp-web.js doesn't have a direct getMessageById on client; the caller
  // should know the chatId too, but we'll try via the id format: bool_chatId_msgId
  try {
    const parts = req.params.messageId.split('_');
    if (parts.length < 3) return errorResponse(res, 400, 'Invalid messageId format – expected serialized id (e.g. true_12345@c.us_ABCDEF)');
    const chatId = parts[1];
    const chat = await client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 50 });
    const msg = messages.find(m => m.id._serialized === req.params.messageId);
    if (!msg) return errorResponse(res, 404, 'Message not found in recent messages');
    if (!msg.hasMedia) return errorResponse(res, 400, 'Message has no media');
    const media = await msg.downloadMedia();
    res.json({ mimetype: media.mimetype, data: media.data, filename: media.filename || null });
  } catch (e) { errorResponse(res, 500, e.message); }
});

// ---- Monitoring -----------------------------------------------------------

app.get('/monitor', (_req, res) => {
  res.json(Object.entries(monitors).map(([id, m]) => ({ contactId: id, ...m })));
});

app.post('/monitor', (req, res) => {
  const { contactId, script, webhook } = req.body || {};
  if (!contactId) return errorResponse(res, 400, 'Missing required field: contactId');
  const nid = normaliseChatId(contactId);
  monitors[nid] = { script: script || null, webhook: webhook || null, createdAt: new Date().toISOString() };
  saveMonitors(monitors);
  res.json({ success: true, contactId: nid });
});

app.delete('/monitor/:contactId', (req, res) => {
  const nid = normaliseChatId(req.params.contactId);
  if (!monitors[nid]) return errorResponse(res, 404, 'Monitor not found');
  delete monitors[nid];
  saveMonitors(monitors);
  res.json({ success: true, removed: nid });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[Server] Listening on 127.0.0.1:${PORT}`);
  console.log('[WA] Initializing client…');
  client.initialize().catch(console.error);
});

// Graceful shutdown
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[Server] ${signal} received – shutting down…`);
  try { await client.destroy(); } catch {}
  server.close(() => {
    console.log('[Server] Closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
