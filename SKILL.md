---
name: openclaw-wa-bridge
description: "WhatsApp bridge for OpenClaw — send/receive messages, search chats, manage contacts via REST API + CLI. Incoming messages trigger OpenClaw webhooks for real-time agent responses. Use when the user wants to send WhatsApp messages, check WhatsApp chats, search message history, or manage WhatsApp monitoring."
homepage: https://github.com/andrepaim/openclaw-wa-bridge
metadata: { "openclaw": { "emoji": "📱", "requires": { "bins": ["node"] } } }
---

# WhatsApp Bridge

Send and receive WhatsApp messages via a REST API service + CLI.

## Architecture

- **Service** (`{baseDir}/service/index.js`): Express REST API + whatsapp-web.js client. Runs as a background service (systemd). Incoming messages trigger OpenClaw agent webhooks automatically.
- **CLI** (`wa-cli`): Talks to the running service over HTTP. Quick commands for sending, searching, listing chats.

## Prerequisites

- Node.js 18+
- `npm install` in `{baseDir}`
- One-time QR scan: start the service, visit `/qr` endpoint, scan with WhatsApp
- Configure `hook-rules.json` from `hook-rules.json.example`

## When to Use

✅ **USE this skill when:**

- "Send a WhatsApp message to [person]"
- "Check my WhatsApp messages"
- "Search WhatsApp for [query]"
- "Who messaged me on WhatsApp?"
- "List my WhatsApp groups"
- "Monitor WhatsApp contact [number]"

## When NOT to Use

❌ **DON'T use this skill when:**

- User wants to use Telegram, Signal, or other messengers
- Real-time video/voice calls
- WhatsApp Business API features (catalogs, payments)

## CLI Commands

The CLI connects to the running service. Set `WA_BRIDGE_URL` (default: `http://127.0.0.1:3100`) and optionally `WA_BRIDGE_TOKEN`.

```bash
# Connection
wa-cli status                              # Check connection status

# Messaging
wa-cli send <number> <message>             # Send to number (auto-appends @c.us)
wa-cli send-group <groupId> <message>      # Send to group

# Chats & Messages
wa-cli chats [--limit N]                   # List recent chats
wa-cli messages <chatId> [--limit N]       # Get messages from a chat
wa-cli search <query> [--chat id] [--limit N]  # Search messages

# Contacts & Groups
wa-cli contacts [--search query]           # List or search contacts
wa-cli groups [--search query]             # List or search groups

# Events (incoming message queue)
wa-cli events                              # Get and flush pending events
wa-cli events --peek                       # Peek without flushing

# Monitors
wa-cli monitor                             # List active monitors
wa-cli monitor add <contactId>             # Add monitor
wa-cli monitor remove <contactId>          # Remove monitor
```

## REST API (for direct HTTP calls)

If the CLI isn't available, use curl:

```bash
BASE="http://127.0.0.1:3100"

# Send message
curl -s -X POST $BASE/send -H 'Content-Type: application/json' \
  -d '{"to":"5511999999999","message":"Hello!"}'

# Send to group
curl -s -X POST $BASE/send-group -H 'Content-Type: application/json' \
  -d '{"groupId":"123456789@g.us","message":"Hello group!"}'

# Get status
curl -s $BASE/status

# List chats
curl -s $BASE/chats

# Search messages
curl -s "$BASE/search?q=meeting&limit=10"

# Get events (flushes queue)
curl -s $BASE/events

# Peek events (no flush)
curl -s $BASE/events/peek
```

## OpenClaw Integration

The service automatically sends webhooks to OpenClaw when messages arrive. Configure in `hook-rules.json`:

- **hookUrl**: OpenClaw agent hook endpoint (default: `http://127.0.0.1:18789/hooks/agent`)
- **hookToken**: Authentication token for the hook
- **contacts.categories**: Define who gets auto-replies vs notifications
- **contacts.defaults**: How to handle groups and unknown senders

Each incoming message creates an agent session with full context (sender info, routing rules, reply instructions).

## Service Management

```bash
# Start directly
node {baseDir}/service/index.js

# Or via systemd (edit wa-bridge.service with your paths first)
sudo cp {baseDir}/service/wa-bridge.service /etc/systemd/system/
sudo systemctl enable wa-bridge
sudo systemctl start wa-bridge
```

## Monitoring (Cron)

For periodic inbox checks (backup to real-time webhooks):

```json
{
  "name": "WA Bridge Inbox Check",
  "schedule": { "kind": "every", "everyMs": 120000 },
  "payload": { "kind": "agentTurn", "message": "Check for new WhatsApp messages: wa-cli events. If empty, reply NO_REPLY. If messages exist, notify on Telegram with summary." },
  "sessionTarget": "isolated"
}
```

## Error Handling

- Service not running → CLI returns connection error; start the service
- QR expired → Restart service, scan new QR at `/qr`
- 503 responses → WhatsApp client not ready; check `/status`
- Auth failure → Delete `auth/` directory and re-scan QR
