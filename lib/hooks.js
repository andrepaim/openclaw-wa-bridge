'use strict';

const http = require('http');

/**
 * Build a human-readable contact directory from categories.
 */
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

/**
 * Build routing rules description from categories + defaults.
 */
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
  }
  lines.push('');
  lines.push('== HOW TO NOTIFY ON TELEGRAM ==');
  lines.push(`Use the message tool: action=send, channel=telegram, target=${tgChatId}, message=your summary`);
  return lines.join('\n');
}

/**
 * Determine which category a message sender belongs to.
 */
function matchCategory(from, pushName, categories) {
  for (const [name, cat] of Object.entries(categories)) {
    if (cat.ids && cat.ids.includes(from)) return { name, ...cat };
    if (cat.matchName && pushName && pushName.toLowerCase().includes(cat.matchName.toLowerCase())) {
      return { name, ...cat };
    }
  }
  return null;
}

/**
 * Build the full webhook message for OpenClaw.
 */
function buildHookMessage(entry, hookRules, bridgePort) {
  const sender = entry.pushName || entry.from.replace('@c.us', '').replace('@g.us', '');
  const group = entry.isGroup ? ` (grupo: ${entry.chatName || '?'})` : '';
  const body = (entry.body || '[mídia]').slice(0, 1000);
  const waId = entry.from;
  const { categories, defaults } = hookRules.contacts;
  const tgChatId = hookRules.telegram.chatId;
  const port = bridgePort || 3100;

  return [
    '📱 WhatsApp message received:',
    `From: ${sender}${group}`,
    `WA ID: ${waId}`,
    `Type: ${entry.type || 'chat'}`,
    entry.hasMedia ? 'Has media: yes' : null,
    '',
    `Message: ${body}`,
    '',
    '== CONTACT DIRECTORY ==',
    buildContactDirectory(categories),
    '',
    '== ROUTING RULES ==',
    buildRoutingRules(categories, defaults, tgChatId),
    '',
    '== HOW TO REPLY ON WHATSAPP ==',
    `curl -s -X POST http://127.0.0.1:${port}/send -H 'Content-Type: application/json' -d '{"to":"${waId}","message":"YOUR_REPLY"}'`,
  ].filter(x => x !== null).join('\n');
}

/**
 * Send webhook notification to OpenClaw hook endpoint.
 */
function notifyOpenClaw(entry, hookRules, bridgePort) {
  const message = buildHookMessage(entry, hookRules, bridgePort);
  const waId = entry.from;

  const payload = JSON.stringify({
    message,
    name: 'WhatsApp',
    sessionKey: `hook:wa:${waId}`,
    wakeMode: 'now',
    deliver: false,
    timeoutSeconds: 120,
  });

  const url = new URL(hookRules.openclaw.hookUrl);
  const req = http.request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${hookRules.openclaw.hookToken}`,
      'Content-Length': Buffer.byteLength(payload),
    },
  });
  req.on('error', (e) => console.error('[OC] Hook error:', e.message));
  req.end(payload);

  const sender = entry.pushName || entry.from;
  const bodyPreview = (entry.body || '').slice(0, 60);
  console.log(`[OC] Hook sent: ${sender} → "${bodyPreview}"`);
}

module.exports = {
  buildContactDirectory,
  buildRoutingRules,
  buildHookMessage,
  matchCategory,
  notifyOpenClaw,
};
