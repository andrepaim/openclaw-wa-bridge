'use strict';

const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const EventQueue = require('./events');

/** Normalise a chat id — append @c.us or @g.us if missing */
function normaliseChatId(id, group = false) {
  if (!id) return id;
  id = String(id).trim();
  if (id.includes('@')) return id;
  return group ? `${id}@g.us` : `${id}@c.us`;
}

/**
 * Create the Express app.
 * @param {object} waClient - whatsapp-web.js Client instance
 * @param {object} clientState - { ready, qr, info } mutable state
 * @param {object} options - { apiToken, eventsDir, logsDir }
 */
function createApp(waClient, clientState, options = {}) {
  const app = express();
  app.use(express.json());

  const apiToken = options.apiToken || '';
  const eventsDir = options.eventsDir || path.join(process.cwd(), 'events');
  const logsDir = options.logsDir || path.join(process.cwd(), 'logs');
  const monitorsFile = options.monitorsFile || path.join(process.cwd(), 'monitors.json');

  fs.mkdirSync(logsDir, { recursive: true });
  const eventQueue = new EventQueue(eventsDir);

  // Monitors
  function loadMonitors() {
    try { return JSON.parse(fs.readFileSync(monitorsFile, 'utf8')); } catch { return {}; }
  }
  function saveMonitors(m) { fs.writeFileSync(monitorsFile, JSON.stringify(m, null, 2)); }
  let monitors = loadMonitors();

  // Helpers
  function error(res, status, message) { return res.status(status).json({ error: message }); }
  function requireConnected(res) {
    if (!clientState.ready) { error(res, 503, 'WhatsApp client is not connected'); return false; }
    return true;
  }

  // Auth middleware
  app.use((req, res, next) => {
    if (!apiToken) return next();
    const auth = req.headers.authorization;
    if (auth === `Bearer ${apiToken}`) return next();
    return error(res, 401, 'Unauthorized');
  });

  // -- Connection --

  app.get('/status', (_req, res) => {
    res.json({
      status: clientState.ready ? 'connected' : (clientState.qr ? 'waiting_for_qr' : 'disconnected'),
      info: clientState.info ? {
        pushname: clientState.info.pushname,
        wid: clientState.info.wid?._serialized,
        platform: clientState.info.platform,
      } : null,
    });
  });

  app.get('/qr', async (_req, res) => {
    if (!clientState.qr) return res.json({ qr: null, message: clientState.ready ? 'Already authenticated' : 'No QR available yet' });
    try {
      const base64 = await QRCode.toDataURL(clientState.qr);
      res.json({ qr: clientState.qr, base64 });
    } catch (e) { error(res, 500, e.message); }
  });

  // -- Events --

  app.get('/events', (_req, res) => {
    try { res.json(eventQueue.flush()); }
    catch (e) { error(res, 500, e.message); }
  });

  app.get('/events/peek', (_req, res) => {
    try { res.json(eventQueue.peek()); }
    catch (e) { error(res, 500, e.message); }
  });

  // -- Chats --

  app.get('/chats', async (_req, res) => {
    if (!requireConnected(res)) return;
    try {
      const chats = await waClient.getChats();
      res.json(chats.map(c => ({
        id: c.id._serialized,
        name: c.name,
        isGroup: c.isGroup,
        unreadCount: c.unreadCount,
        timestamp: c.timestamp,
        lastMessage: c.lastMessage ? { body: c.lastMessage.body?.substring(0, 100), fromMe: c.lastMessage.fromMe } : null,
      })));
    } catch (e) { error(res, 500, e.message); }
  });

  app.get('/chats/:chatId/messages', async (req, res) => {
    if (!requireConnected(res)) return;
    try {
      const chatId = normaliseChatId(req.params.chatId, req.params.chatId.includes('g.us'));
      const chat = await waClient.getChatById(chatId);
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
    } catch (e) { error(res, 500, e.message); }
  });

  // -- Contacts --

  app.get('/contacts', async (_req, res) => {
    if (!requireConnected(res)) return;
    try {
      const contacts = await waClient.getContacts();
      res.json(contacts.map(c => ({
        id: c.id._serialized,
        name: c.name || c.pushname || null,
        number: c.number,
        isMyContact: c.isMyContact,
        isGroup: c.isGroup,
      })));
    } catch (e) { error(res, 500, e.message); }
  });

  app.get('/contacts/search', async (req, res) => {
    if (!requireConnected(res)) return;
    const q = (req.query.q || '').toLowerCase();
    if (!q) return error(res, 400, 'Missing query parameter q');
    try {
      const contacts = await waClient.getContacts();
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
    } catch (e) { error(res, 500, e.message); }
  });

  // -- Groups --

  app.get('/groups', async (_req, res) => {
    if (!requireConnected(res)) return;
    try {
      const chats = await waClient.getChats();
      res.json(chats.filter(c => c.isGroup).map(c => ({
        id: c.id._serialized,
        name: c.name,
        participants: c.groupMetadata?.participants?.length || null,
      })));
    } catch (e) { error(res, 500, e.message); }
  });

  app.get('/groups/search', async (req, res) => {
    if (!requireConnected(res)) return;
    const q = (req.query.q || '').toLowerCase();
    if (!q) return error(res, 400, 'Missing query parameter q');
    try {
      const chats = await waClient.getChats();
      const groups = chats.filter(c => c.isGroup && c.name.toLowerCase().includes(q));
      res.json(groups.map(c => ({ id: c.id._serialized, name: c.name })));
    } catch (e) { error(res, 500, e.message); }
  });

  app.get('/groups/:groupId/info', async (req, res) => {
    if (!requireConnected(res)) return;
    try {
      const gid = normaliseChatId(req.params.groupId, true);
      const chat = await waClient.getChatById(gid);
      if (!chat.isGroup) return error(res, 400, 'Not a group chat');
      const meta = chat.groupMetadata;
      res.json({
        id: chat.id._serialized,
        name: chat.name,
        description: meta?.desc || null,
        participants: meta?.participants?.map(p => ({
          id: p.id._serialized,
          isAdmin: p.isAdmin,
          isSuperAdmin: p.isSuperAdmin,
        })) || [],
        createdAt: meta?.creation || null,
      });
    } catch (e) { error(res, 500, e.message); }
  });

  // -- Messaging --

  app.post('/send', async (req, res) => {
    if (!requireConnected(res)) return;
    const { to, message } = req.body || {};
    if (!to || !message) return error(res, 400, 'Missing required fields: to, message');
    try {
      const chatId = normaliseChatId(to);
      const sent = await waClient.sendMessage(chatId, message);
      res.json({ success: true, messageId: sent.id._serialized, to: chatId });
    } catch (e) { error(res, 500, e.message); }
  });

  app.post('/send-group', async (req, res) => {
    if (!requireConnected(res)) return;
    const { groupId, message } = req.body || {};
    if (!groupId || !message) return error(res, 400, 'Missing required fields: groupId, message');
    try {
      const gid = normaliseChatId(groupId, true);
      const sent = await waClient.sendMessage(gid, message);
      res.json({ success: true, messageId: sent.id._serialized, to: gid });
    } catch (e) { error(res, 500, e.message); }
  });

  // -- Search --

  app.get('/search', async (req, res) => {
    if (!requireConnected(res)) return;
    const q = req.query.q;
    if (!q) return error(res, 400, 'Missing query parameter q');
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    try {
      const searchOpts = { limit };
      if (req.query.chatId) searchOpts.chatId = normaliseChatId(req.query.chatId, req.query.chatId.includes('g.us'));
      const messages = await waClient.searchMessages(q, searchOpts);
      res.json(messages.map(m => ({
        id: m.id._serialized,
        from: m.from,
        author: m.author || null,
        body: m.body,
        timestamp: m.timestamp,
        chatName: m.chat?.name || null,
      })));
    } catch (e) { error(res, 500, e.message); }
  });

  // -- Media --

  app.get('/messages/:messageId/media', async (req, res) => {
    if (!requireConnected(res)) return;
    try {
      const parts = req.params.messageId.split('_');
      if (parts.length < 3) return error(res, 400, 'Invalid messageId format');
      const chatId = parts[1];
      const chat = await waClient.getChatById(chatId);
      const messages = await chat.fetchMessages({ limit: 50 });
      const msg = messages.find(m => m.id._serialized === req.params.messageId);
      if (!msg) return error(res, 404, 'Message not found in recent messages');
      if (!msg.hasMedia) return error(res, 400, 'Message has no media');
      const media = await msg.downloadMedia();
      res.json({ mimetype: media.mimetype, data: media.data, filename: media.filename || null });
    } catch (e) { error(res, 500, e.message); }
  });

  // -- Monitors --

  app.get('/monitor', (_req, res) => {
    res.json(Object.entries(monitors).map(([id, m]) => ({ contactId: id, ...m })));
  });

  app.post('/monitor', (req, res) => {
    const { contactId, script, webhook } = req.body || {};
    if (!contactId) return error(res, 400, 'Missing required field: contactId');
    const nid = normaliseChatId(contactId);
    monitors[nid] = { script: script || null, webhook: webhook || null, createdAt: new Date().toISOString() };
    saveMonitors(monitors);
    res.json({ success: true, contactId: nid });
  });

  app.delete('/monitor/:contactId', (req, res) => {
    const nid = normaliseChatId(req.params.contactId);
    if (!monitors[nid]) return error(res, 404, 'Monitor not found');
    delete monitors[nid];
    saveMonitors(monitors);
    res.json({ success: true, removed: nid });
  });

  // Expose internals for message handler wiring
  app._eventQueue = eventQueue;
  app._monitors = () => monitors;
  app._logsDir = logsDir;
  app._normaliseChatId = normaliseChatId;

  return app;
}

module.exports = { createApp, normaliseChatId };
