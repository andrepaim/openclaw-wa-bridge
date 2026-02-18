# 🌉 OpenClaw WhatsApp Bridge

A REST API bridge between [OpenClaw](https://github.com/openclaw/openclaw) and WhatsApp, powered by [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js).

Connect your WhatsApp account and get a clean HTTP API to read messages, send texts, search conversations, monitor contacts, and more — all from localhost.

## Why this instead of OpenClaw's built-in WhatsApp channel?

OpenClaw has a [native WhatsApp channel](https://docs.openclaw.ai) that lets you *chat with* the agent via WhatsApp — like Telegram or Discord. This bridge does something different: it lets the agent *read, search, and act on* your WhatsApp data.

| Capability | Official Channel | WA Bridge |
|------------|:---:|:---:|
| Chat with OpenClaw agent via WhatsApp | ✅ | ❌ |
| Automatic session/routing management | ✅ | ❌ |
| Read message history from any chat | ❌ | ✅ |
| Search across all conversations | ❌ | ✅ |
| Summarize group chats | ❌ | ✅ |
| List chats, contacts, groups | ❌ | ✅ |
| Download media from messages | ❌ | ✅ |
| Monitor contacts with webhooks | ❌ | ✅ |
| Event queue for polling-based integrations | ❌ | ✅ |
| Send from any context (no cross-context limits) | ❌ | ✅ |

**TL;DR:** Official channel = WhatsApp talks *to* the agent. Bridge = agent talks *to* WhatsApp.

They're **complementary in theory**, but WhatsApp only allows one web session per number, so you can't run both on the same number. Options: use the bridge only (recommended for power users), use separate numbers, or alternate between them. See [detailed comparison](#detailed-comparison-with-official-channel) below.

## Features

- 📱 **WhatsApp Web connection** with persistent session (LocalAuth)
- 🔌 **20 REST endpoints** for full WhatsApp interaction
- 🔍 **Search** messages globally or per chat
- 👥 **Groups** — list, search, get info, send messages
- 📡 **Contact monitoring** with webhook forwarding & keyword auto-reply
- 📬 **Event queue** — JSONL-based incoming message queue for polling
- 🔗 **OpenClaw webhook integration** — forward messages to OpenClaw for AI processing
- 🔔 **Telegram notifications** — optional instant forwarding to Telegram
- 🔒 **Bearer token auth** (optional)
- 🔄 **Auto-reconnect** on disconnection
- 🛑 **Graceful shutdown** (SIGTERM/SIGINT)

## Quick Start

```bash
git clone https://github.com/andrepaim/openclaw-wa-bridge.git
cd openclaw-wa-bridge
npm install
node index.js
```

A QR code will appear in the terminal. Scan it with your phone:
**WhatsApp → Settings → Linked Devices → Link a Device**

The API is available at `http://127.0.0.1:3100`.

## Configuration

Copy `.env.example` to `.env` and customize:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | API server port | `3100` |
| `WA_API_TOKEN` | Bearer token for API auth (optional, leave empty to disable) | — |
| `PUPPETEER_CACHE_DIR` | Chromium cache directory | — |
| `TG_BOT_TOKEN` | Telegram bot token for instant notifications (optional) | — |
| `TG_CHAT_ID` | Telegram chat ID to receive notifications (optional) | — |

When `TG_BOT_TOKEN` and `TG_CHAT_ID` are both set, incoming WhatsApp messages are instantly forwarded to your Telegram chat.

## Authentication

If `WA_API_TOKEN` is set, all requests require an `Authorization` header:

```bash
WA_API_TOKEN=mysecret node index.js
curl -H "Authorization: Bearer mysecret" http://127.0.0.1:3100/status
```

Without the env var, no auth is required (localhost-only by default).

## ⚠️ Important: Contact ID Formats

WhatsApp uses different ID formats depending on the contact type. You'll encounter these in API responses:

| Format | Example | Description |
|--------|---------|-------------|
| `number@c.us` | `5511999999999@c.us` | Standard phone contact |
| `number@lid` | `123456789012345@lid` | Linked ID (newer WhatsApp format) |
| `number@g.us` | `120363001234567890@g.us` | Group chat |

**LIDs (Linked IDs)** are WhatsApp's newer internal identifier format. Some contacts return LIDs instead of phone numbers. When sending messages, you can use:
- A **phone number** (auto-appends `@c.us`): `"to": "5511999999999"`
- A **full ID** (passed as-is): `"to": "123456789012345@lid"`

**Tip:** Use `/contacts` or `/search` to discover the correct ID for a contact before sending.

## API Reference

### 🔗 Connection

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/status` | Connection status + client info |
| `GET` | `/qr` | QR code as base64 image + raw text |

```bash
curl localhost:3100/status
# {"status":"connected","info":{"pushname":"MyBot","wid":"5511888888888@c.us",...}}

curl localhost:3100/qr
# {"qr":"data:image/png;base64,...","raw":"2@ABC..."}
```

### 📬 Event Queue

Incoming messages are logged to a JSONL file. Use these endpoints to poll for new messages:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/events` | Read all queued events and **flush** the queue |
| `GET` | `/events/peek` | Read all queued events **without flushing** |

```bash
# Poll and consume events (queue is cleared after reading)
curl localhost:3100/events

# Peek at events without consuming them
curl localhost:3100/events/peek
```

**Event format:**
```json
{
  "from": "5511999999999@c.us",
  "body": "Oi, tudo bem?",
  "timestamp": 1707840000,
  "chatName": "Andre",
  "type": "chat"
}
```

**`/events` vs `/events/peek`:** Use `/events` for cron-based polling (read once, process, done). Use `/events/peek` when you want to inspect without consuming (e.g., debugging).

### 💬 Chats & Messages

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/chats` | List all chats |
| `GET` | `/chats/:chatId/messages?limit=20` | Fetch last N messages from a chat |
| `GET` | `/search?q=term&chatId=optional&limit=20` | Search messages |

```bash
# List all chats
curl localhost:3100/chats

# Get last 50 messages from a contact
curl "localhost:3100/chats/5511999999999@c.us/messages?limit=50"

# Search for "reunião" across all chats
curl "localhost:3100/search?q=reunião&limit=10"

# Search within a specific chat (works with LIDs too)
curl "localhost:3100/search?q=projeto&chatId=123456789012345@lid&limit=10"
```

**Message format:**
```json
{
  "id": "true_5511999999999@c.us_ABC123",
  "from": "5511999999999@c.us",
  "author": null,
  "body": "Oi, tudo bem?",
  "timestamp": 1707840000,
  "fromMe": false,
  "hasMedia": false,
  "type": "chat"
}
```

### 👤 Contacts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/contacts` | List all contacts |
| `GET` | `/contacts/search?q=name` | Search contacts by name |

```bash
curl localhost:3100/contacts
curl "localhost:3100/contacts/search?q=Andre"
```

**Note:** Contact objects include both `id` (which may be a LID) and `number` fields. Use `id` for sending messages.

### 👥 Groups

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/groups` | List all groups |
| `GET` | `/groups/search?q=name` | Search groups by name |
| `GET` | `/groups/:groupId/info` | Group details (participants, description) |

```bash
curl localhost:3100/groups
curl "localhost:3100/groups/search?q=Família"
curl "localhost:3100/groups/120363001234567890@g.us/info"
```

### ✉️ Send Messages

| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| `POST` | `/send` | `{to, message}` | Send to a contact |
| `POST` | `/send-group` | `{groupId, message}` | Send to a group |

```bash
# Send to a contact using phone number
curl -X POST localhost:3100/send \
  -H 'Content-Type: application/json' \
  -d '{"to":"5511999999999","message":"Fala, Andre!"}'

# Send to a contact using LID
curl -X POST localhost:3100/send \
  -H 'Content-Type: application/json' \
  -d '{"to":"123456789012345@lid","message":"Oi Sara!"}'

# Send to a group
curl -X POST localhost:3100/send-group \
  -H 'Content-Type: application/json' \
  -d '{"groupId":"120363001234567890@g.us","message":"Bom dia galera!"}'
```

### 🖼️ Media

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/messages/:messageId/media` | Download media (base64 + mimetype) |

```bash
curl "localhost:3100/messages/true_5511999999999@c.us_ABC123/media"
# {"mimetype":"image/jpeg","data":"base64...","filename":"photo.jpg"}
```

### 📡 Monitoring

Monitor specific contacts for new messages. Optionally forward to a webhook or auto-reply with keyword matching.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/monitor` | Add a contact monitor |
| `GET` | `/monitor` | List active monitors |
| `DELETE` | `/monitor/:contactId` | Remove a monitor |

```bash
# Monitor a contact with webhook
curl -X POST localhost:3100/monitor \
  -H 'Content-Type: application/json' \
  -d '{
    "contactId": "5511999999999",
    "webhook": "http://localhost:8080/hook",
    "script": "oi=Olá! Sou o assistente do Andre. Ele não está disponível no momento."
  }'

# List monitors
curl localhost:3100/monitor

# Remove monitor
curl -X DELETE "localhost:3100/monitor/5511999999999@c.us"
```

**Script format** (keyword=response, one per line):
```
oi=Olá! Como posso ajudar?
preço=Nossos preços estão no site: example.com
horário=Funcionamos de 8h às 18h
```

**Webhook payload:**
```json
{
  "contactId": "5511999999999@c.us",
  "message": {
    "id": "...",
    "from": "5511999999999@c.us",
    "body": "Oi, tudo bem?",
    "timestamp": 1707840000
  }
}
```

Monitored messages are also logged as JSONL files in `logs/`.

## 🔗 OpenClaw Webhook Integration

The bridge can automatically forward incoming WhatsApp messages to OpenClaw as webhook events for real-time AI processing.

**How it works:**
1. A WhatsApp message arrives at the bridge
2. The bridge sends it as a POST to OpenClaw's `/hooks/agent` endpoint
3. OpenClaw processes the message using configured routing rules
4. The agent can reply on WhatsApp (via the bridge REST API) and/or notify on Telegram

### Setup

1. Copy the example config:
```bash
cp hook-rules.json.example hook-rules.json
```

2. Edit `hook-rules.json` with your contacts and preferences:
```json
{
  "openclaw": {
    "hookUrl": "http://127.0.0.1:18789/hooks/agent",
    "hookToken": "your-hook-secret-here"
  },
  "ignoreIds": ["your-bridge-number@c.us"],
  "contacts": {
    "categories": {
      "family": {
        "ids": ["5511999999999@c.us", "123456789012345@lid"],
        "action": "reply-and-notify",
        "style": "casual"
      },
      "suppliers": {
        "ids": ["5511777777777@c.us"],
        "action": "reply-and-notify",
        "style": "professional",
        "context": "Check memory files for outreach scripts"
      }
    },
    "defaults": {
      "groups": { "action": "ignore" },
      "unknown": { "action": "notify-only" }
    }
  },
  "telegram": {
    "chatId": "your-telegram-chat-id"
  }
}
```

3. Enable hooks in your OpenClaw gateway config:
   - `hooks.enabled: true`
   - `hooks.token` must match `openclaw.hookToken` above

### Routing Actions

| Action | Behavior |
|--------|----------|
| `reply-and-notify` | AI processes and replies on WhatsApp + notifies owner on Telegram |
| `notify-only` | No reply, just forwards to Telegram |
| `ignore` | Silently ignores (default for groups) |

The `ignoreIds` array should include your own WhatsApp number to prevent the bridge from processing its own outgoing messages.

## Running as a Service (systemd)

A sample systemd unit file is included. **Edit it to match your paths and user before installing:**

```bash
# Review and edit the service file first!
nano wa-service.service

sudo cp wa-service.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable wa-service
sudo systemctl start wa-service

# Check status
sudo systemctl status wa-service

# View logs
sudo journalctl -u wa-service -f
```

Key settings to customize in `wa-service.service`:
- `User=` — your system username
- `WorkingDirectory=` — path to the cloned repo
- `EnvironmentFile=` — path to your `.env` file

## Detailed Comparison with Official Channel

### Substitute or complement?

**They're complementary in theory**, but WhatsApp only allows **one web session per phone number** — so you can't run both on the same number simultaneously.

| Option | Setup | Pros | Cons |
|--------|-------|------|------|
| **A — Bridge only** (recommended) | Single number on bridge | Full WA access, no cross-context limits | No native chat routing |
| **B — Separate numbers** | Bot number on official, personal on bridge | Best of both worlds | Requires two numbers |
| **C — Alternate** | Switch as needed | Flexible | Impractical for daily use |

For most power users, **Option A** is the sweet spot — the bridge's read/search/monitor capabilities far outweigh the convenience of native routing, and you can replicate routing via the monitor + webhook features.

## Tech Stack

- **[whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js)** — WhatsApp Web client
- **[Express](https://expressjs.com/)** — HTTP server
- **[Puppeteer](https://pptr.dev/)** — Headless Chrome for WhatsApp Web
- **Node.js 18+**

## ⚠️ Disclaimer

This project uses an unofficial WhatsApp API. WhatsApp does not allow bots or unofficial clients on their platform. Use at your own risk. This should not be considered totally safe and your account could potentially be banned.

## License

MIT
