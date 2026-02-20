'use strict';

const http = require('http');
const https = require('https');

class BridgeCLI {
  constructor(baseUrl, token) {
    this.baseUrl = (baseUrl || 'http://127.0.0.1:3100').replace(/\/$/, '');
    this.token = token || '';
  }

  async request(method, path, body) {
    const url = new URL(path, this.baseUrl);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const payload = body ? JSON.stringify(body) : null;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    return new Promise((resolve, reject) => {
      const req = transport.request(url, { method, headers }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(json.error || `HTTP ${res.statusCode}`));
            } else {
              resolve(json);
            }
          } catch {
            reject(new Error(`Invalid JSON response: ${data.slice(0, 200)}`));
          }
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  async status() { return this.request('GET', '/status'); }
  async events(peek = false) { return this.request('GET', peek ? '/events/peek' : '/events'); }
  async chats(limit) { return this.request('GET', `/chats${limit ? `?limit=${limit}` : ''}`); }
  async contacts(search) { return search ? this.request('GET', `/contacts/search?q=${encodeURIComponent(search)}`) : this.request('GET', '/contacts'); }
  async groups(search) { return search ? this.request('GET', `/groups/search?q=${encodeURIComponent(search)}`) : this.request('GET', '/groups'); }
  async messages(chatId, limit) { return this.request('GET', `/chats/${encodeURIComponent(chatId)}/messages?limit=${limit || 20}`); }
  async search(query, chatId, limit) {
    let url = `/search?q=${encodeURIComponent(query)}`;
    if (chatId) url += `&chatId=${encodeURIComponent(chatId)}`;
    if (limit) url += `&limit=${limit}`;
    return this.request('GET', url);
  }
  async send(to, message) { return this.request('POST', '/send', { to, message }); }
  async sendGroup(groupId, message) { return this.request('POST', '/send-group', { groupId, message }); }
  async monitorList() { return this.request('GET', '/monitor'); }
  async monitorAdd(contactId, opts = {}) { return this.request('POST', '/monitor', { contactId, ...opts }); }
  async monitorRemove(contactId) { return this.request('DELETE', `/monitor/${encodeURIComponent(contactId)}`); }
}

/**
 * Parse CLI args and execute command.
 */
async function run(args, options = {}) {
  const baseUrl = options.baseUrl || process.env.WA_BRIDGE_URL || 'http://127.0.0.1:3100';
  const token = options.token || process.env.WA_BRIDGE_TOKEN || '';
  const cli = new BridgeCLI(baseUrl, token);
  const out = options.output || process.stdout;

  function print(data) {
    out.write(JSON.stringify(data, null, 2) + '\n');
  }

  const cmd = args[0];
  if (!cmd || cmd === 'help' || cmd === '--help') {
    out.write(`Usage: wa-cli <command> [options]

Commands:
  status                          Connection status
  send <number> <message>         Send message to number
  send-group <groupId> <message>  Send to group
  chats [--limit N]               List chats
  contacts [--search query]       List/search contacts
  groups [--search query]         List/search groups
  messages <chatId> [--limit N]   Get messages from chat
  search <query> [--chat id] [--limit N]  Search messages
  events [--peek]                 Get event queue (peek = don't flush)
  monitor list                    List monitors
  monitor add <contactId>         Add monitor
  monitor remove <contactId>      Remove monitor

Environment:
  WA_BRIDGE_URL    Base URL (default: http://127.0.0.1:3100)
  WA_BRIDGE_TOKEN  API token (optional)
`);
    return;
  }

  function getFlag(flag) {
    const idx = args.indexOf(flag);
    if (idx === -1) return null;
    return args[idx + 1] || true;
  }

  try {
    switch (cmd) {
      case 'status':
        print(await cli.status());
        break;
      case 'send':
        if (args.length < 3) throw new Error('Usage: wa-cli send <number> <message>');
        print(await cli.send(args[1], args.slice(2).join(' ')));
        break;
      case 'send-group':
        if (args.length < 3) throw new Error('Usage: wa-cli send-group <groupId> <message>');
        print(await cli.sendGroup(args[1], args.slice(2).join(' ')));
        break;
      case 'chats':
        print(await cli.chats(getFlag('--limit')));
        break;
      case 'contacts':
        print(await cli.contacts(getFlag('--search')));
        break;
      case 'groups':
        print(await cli.groups(getFlag('--search')));
        break;
      case 'messages':
        if (!args[1]) throw new Error('Usage: wa-cli messages <chatId> [--limit N]');
        print(await cli.messages(args[1], getFlag('--limit')));
        break;
      case 'search':
        if (!args[1]) throw new Error('Usage: wa-cli search <query> [--chat chatId] [--limit N]');
        print(await cli.search(args[1], getFlag('--chat'), getFlag('--limit')));
        break;
      case 'events':
        print(await cli.events(args.includes('--peek')));
        break;
      case 'monitor':
        if (args[1] === 'add') {
          if (!args[2]) throw new Error('Usage: wa-cli monitor add <contactId>');
          print(await cli.monitorAdd(args[2]));
        } else if (args[1] === 'remove') {
          if (!args[2]) throw new Error('Usage: wa-cli monitor remove <contactId>');
          print(await cli.monitorRemove(args[2]));
        } else {
          print(await cli.monitorList());
        }
        break;
      default:
        throw new Error(`Unknown command: ${cmd}. Run wa-cli help for usage.`);
    }
  } catch (e) {
    out.write(JSON.stringify({ error: e.message }) + '\n');
    if (!options.noExit) process.exitCode = 1;
  }
}

module.exports = { BridgeCLI, run };
