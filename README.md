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
| Send from any context (no cross-context limits) | ❌ | ✅ |

**TL;DR:** Official channel = WhatsApp talks *to* the agent. Bridge = agent talks *to* WhatsApp.

They're **complementary in theory**, but WhatsApp only allows one web session per number, so you can't run both on the same number. Options: use the bridge only (recommended for power users), use separate numbers, or alternate between them. See [detailed comparison](#detailed-comparison-with-official-channel) below.

## Features

- 📱 **WhatsApp Web connection** with persistent session (LocalAuth)
- 🔌 **18 REST endpoints** for full WhatsApp interaction
- 🔍 **Search** messages globally or per chat
- 👥 **Groups** — list, search, get info, send messages
- 📡 **Contact monitoring** with webhook forwarding & keyword auto-reply
- 🔒 **Bearer token auth** (optional)
- 📋 **JSONL logging** of monitored messages
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
| `WA_API_TOKEN` | Bearer token for API auth (optional) | — |
| `PUPPETEER_CACHE_DIR` | Chromium cache directory | — |

## Authentication

If `WA_API_TOKEN` is set, all requests require an `Authorization` header:

```bash
WA_API_TOKEN=mysecret node index.js
curl -H "Authorization: Bearer mysecret" http://127.0.0.1:3100/status
```

Without the env var, no auth is required (localhost-only by default).

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

# Search within a specific chat
curl "localhost:3100/search?q=projeto&chatId=5511999999999@c.us&limit=10"
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
# Send to a contact (number auto-appends @c.us)
curl -X POST localhost:3100/send \
  -H 'Content-Type: application/json' \
  -d '{"to":"5511999999999","message":"Fala, Andre!"}'

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

## Running as a Service (systemd)

```bash
sudo cp wa-service.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable wa-service
sudo systemctl start wa-service

# Check status
sudo systemctl status wa-service

# View logs
sudo journalctl -u wa-service -f
```

## Integration with OpenClaw

This bridge is designed to work with [OpenClaw](https://github.com/openclaw/openclaw) as a WhatsApp backend. OpenClaw agents can call the REST API to:

1. **Read conversations** — Summarize group chats, find specific messages
2. **Send messages** — Reply to contacts or groups
3. **Monitor contacts** — Watch for messages and auto-respond or forward
4. **Search** — Find information across all WhatsApp history

Example: An OpenClaw agent reading last 20 messages from a group and summarizing:
```bash
curl "localhost:3100/groups/search?q=Família"
# → get group ID
curl "localhost:3100/chats/120363001234567890@g.us/messages?limit=20"
# → get messages → feed to LLM for summary
```

### 🔗 OpenClaw Webhook Integration

The bridge can automatically forward incoming WhatsApp messages to OpenClaw as webhook events for real-time AI processing.

**How it works:**
1. A WhatsApp message arrives at the bridge
2. The bridge sends it as a POST to OpenClaw's `/hooks/agent` endpoint
3. OpenClaw processes the message using configured routing rules
4. The agent can reply on WhatsApp (via the bridge REST API) and/or notify on Telegram

**Configuration:**

Copy the example config and fill in your contacts:
```bash
cp hook-rules.json.example hook-rules.json
```

Edit `hook-rules.json` with your contacts, IDs, and preferences. The file is gitignored since it contains personal data.

**Required OpenClaw config** (in your OpenClaw gateway settings):
- `hooks.enabled: true`
- `hooks.token` must match the `openclaw.hookToken` in your `hook-rules.json`

**Routing rules system:**

Each contact category in `hook-rules.json` defines:
- `ids` — WhatsApp IDs belonging to this category
- `action` — What to do when they message:
  - `reply-and-notify` — Auto-reply on WhatsApp + notify owner on Telegram
  - `notify-only` — Don't reply, just notify on Telegram
  - `ignore` — Silently ignore (used for groups by default)
- `style` — Response tone (`casual`, `professional`)
- `context` — Extra instructions for the AI agent

Default rules handle groups (ignore) and unknown contacts (notify-only). The `ignoreIds` array prevents the bridge from processing its own outgoing messages.

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
