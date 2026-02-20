# 📱 OpenClaw WhatsApp Bridge

An [OpenClaw](https://github.com/openclaw/openclaw) skill that bridges WhatsApp messaging through a REST API service + CLI. Incoming messages automatically trigger OpenClaw agent webhooks for real-time AI-powered responses.

## Features

- 💬 **Send & receive** WhatsApp messages (personal + group)
- 🔍 **Search** message history across all chats
- 📋 **List** chats, contacts, groups with metadata
- 🔔 **Real-time webhooks** to OpenClaw on incoming messages
- 📊 **Event queue** for polling-based integrations
- 👀 **Contact monitors** with keyword auto-reply + webhook forwarding
- 🖥️ **CLI + REST API** — use whichever fits your workflow
- 🔐 **Token auth** — optional API token for security
- 🔄 **Auto-reconnect** on disconnection

## Installation

### Via ClawHub

```bash
clawhub install openclaw-wa-bridge
```

### Manual

```bash
cd ~/.openclaw/skills
git clone https://github.com/andrepaim/openclaw-wa-bridge.git
cd openclaw-wa-bridge
npm install
```

## Setup

### 1. Configure hook rules

```bash
cp hook-rules.json.example hook-rules.json
# Edit hook-rules.json with your OpenClaw hook URL, contacts, and routing rules
```

### 2. Start the service

```bash
node service/index.js
```

### 3. Scan QR code

On first run, a QR code appears in the terminal. Scan it with WhatsApp (Linked Devices). The session persists in `auth/`.

### 4. (Optional) Install as systemd service

```bash
# Edit service/wa-bridge.service with your paths
sudo cp service/wa-bridge.service /etc/systemd/system/wa-bridge.service
sudo systemctl enable wa-bridge
sudo systemctl start wa-bridge
```

## CLI Usage

```bash
# Check connection
wa-cli status

# Send a message
wa-cli send 5511999999999 "Hello from OpenClaw!"

# List recent chats
wa-cli chats --limit 10

# Search messages
wa-cli search "meeting notes" --limit 5

# Check incoming events
wa-cli events --peek
```

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/status` | Connection status |
| GET | `/qr` | QR code for authentication |
| POST | `/send` | Send message (`{to, message}`) |
| POST | `/send-group` | Send to group (`{groupId, message}`) |
| GET | `/chats` | List all chats |
| GET | `/chats/:id/messages` | Get chat messages |
| GET | `/contacts` | List contacts |
| GET | `/contacts/search?q=` | Search contacts |
| GET | `/groups` | List groups |
| GET | `/groups/search?q=` | Search groups |
| GET | `/groups/:id/info` | Group details |
| GET | `/search?q=` | Search messages |
| GET | `/events` | Get + flush event queue |
| GET | `/events/peek` | Peek events (no flush) |
| GET | `/messages/:id/media` | Download media |
| GET/POST/DELETE | `/monitor` | Manage monitors |

## OpenClaw Integration

The bridge sends webhooks to OpenClaw's agent hook endpoint whenever a WhatsApp message arrives. The webhook includes:

- Sender info (name, number, group context)
- Message content
- Contact directory (from `hook-rules.json`)
- Routing rules (reply vs notify vs ignore)
- Reply instructions (curl command)

This lets OpenClaw agents handle WhatsApp conversations intelligently based on your configured rules.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Server port |
| `WA_API_TOKEN` | *(none)* | API bearer token |
| `WA_BRIDGE_URL` | `http://127.0.0.1:3100` | CLI: service URL |
| `WA_BRIDGE_TOKEN` | *(none)* | CLI: API token |
| `PUPPETEER_CACHE_DIR` | *(system)* | Chromium cache path |

### hook-rules.json

See `hook-rules.json.example` for the full schema. Key sections:

- **openclaw**: Hook endpoint URL and auth token
- **ignoreIds**: WhatsApp IDs to ignore (e.g., the bridge's own number)
- **contacts.categories**: Named groups with routing actions
- **contacts.defaults**: Fallback rules for groups and unknown senders

## Testing

```bash
npm test
```

52 tests covering:
- REST API endpoints (with mocked WA client)
- Event queue (JSONL read/write/flush)
- Hook routing (category matching, message building)
- CLI commands (with mock HTTP server)

## License

MIT — see [LICENSE](LICENSE).
