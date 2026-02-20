'use strict';

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const path = require('path');

/**
 * Create and configure a whatsapp-web.js Client.
 * Returns { client, state } where state is a mutable object tracking connection.
 */
function createClient(options = {}) {
  const authPath = options.authPath || path.join(process.cwd(), 'auth');
  const puppeteerCacheDir = options.puppeteerCacheDir || process.env.PUPPETEER_CACHE_DIR;

  if (puppeteerCacheDir) {
    process.env.PUPPETEER_CACHE_DIR = puppeteerCacheDir;
  }

  const state = {
    qr: null,
    ready: false,
    info: null,
    shuttingDown: false,
  };

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: authPath }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    },
  });

  client.on('qr', (qr) => {
    state.qr = qr;
    qrcodeTerminal.generate(qr, { small: true });
    console.log('[WA] QR code received — scan with WhatsApp');
  });

  client.on('ready', () => {
    state.ready = true;
    state.qr = null;
    state.info = client.info;
    console.log('[WA] Client ready —', client.info?.pushname || 'unknown');
  });

  client.on('authenticated', () => {
    state.qr = null;
    console.log('[WA] Authenticated');
  });

  client.on('auth_failure', (msg) => {
    console.error('[WA] Auth failure:', msg);
  });

  client.on('disconnected', (reason) => {
    state.ready = false;
    state.info = null;
    console.warn('[WA] Disconnected:', reason);
    if (!state.shuttingDown) {
      console.log('[WA] Reconnecting in 5s…');
      setTimeout(() => {
        if (!state.shuttingDown) client.initialize().catch(console.error);
      }, 5000);
    }
  });

  return { client, state };
}

module.exports = { createClient };
