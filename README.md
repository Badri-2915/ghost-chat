# Ghost Chat — Privacy-First Real-Time Messaging

A privacy-focused, real-time chat application that enables users to communicate instantly without creating accounts, while minimizing stored data and ensuring messages automatically disappear.

**Live:** [https://badri.online](https://badri.online)

---

## Features

- **Room-Based Chat** — Create or join rooms with secret codes
- **Controlled Access** — Room creator approves/rejects join requests
- **Real-Time Messaging** — Instant delivery via WebSockets (Socket.IO)
- **End-to-End Encryption** — AES-GCM encryption using Web Crypto API
- **Ephemeral Messages** — Auto-delete after: seen, 5s, 15s, 30s, 1m, or 5m
- **Typing Indicators** — See when others are typing
- **Read Receipts** — Sent → Delivered → Read status
- **Presence System** — See who's online in the room
- **Rate Limiting** — Protection against spam and abuse
- **No Data Storage** — No accounts, no databases, no persistent logs

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite + TailwindCSS |
| Backend | Node.js + Express + Socket.IO |
| Realtime & Cache | Redis (Pub/Sub, TTL, Presence) |
| Encryption | Web Crypto API (ECDH + AES-GCM) |
| Deployment | Render (backend + Redis) |
| Domain | badri.online |

---

## Local Development

### Prerequisites
- Node.js 20+
- Redis (local or Docker)

### Quick Start

```bash
# Clone the repo
git clone https://github.com/Badri-2915/ghost-chat.git
cd ghost-chat

# Backend
cd backend
cp .env.example .env
npm install
npm run dev

# Frontend (new terminal)
cd frontend
cp .env.example .env
npm install
npm run dev
```

### Using Docker

```bash
docker-compose up
# Frontend: cd frontend && npm run dev
```

App runs at: `http://localhost:5173`

---

## Deployment

### Render (Free Tier)

1. Push to GitHub: `https://github.com/Badri-2915`
2. Render Dashboard → New + → Blueprint → Connect repo
3. Render reads `render.yaml` and creates services automatically
4. Add custom domain `badri.online` in Render settings
5. Configure DNS records in GoDaddy as provided by Render

### UptimeRobot (Keep Alive)

Render free tier sleeps after 15min inactivity.

1. Create account at [uptimerobot.com](https://uptimerobot.com)
2. Add HTTP(s) monitor: `https://badri.online/api/health`
3. Interval: 5 minutes

---

## Architecture

```
Client (React) → WebSocket (Socket.IO) → Node.js Server (Express) → Redis
                                                                      ├── Pub/Sub
                                                                      ├── TTL (auto-delete)
                                                                      ├── Presence tracking
                                                                      └── Rate limiting
```

---

## Security & Privacy

### What this system does:
- Encrypts messages on the client side (AES-GCM)
- Server only relays encrypted data
- No permanent message storage
- No user accounts or personal data collection
- Messages auto-delete from all locations

### Honest Limitations:
- Cannot prevent network-level metadata visibility (IP by ISP/hosting)
- Cannot fully prevent screenshots
- Messages are permanently lost after deletion
- Requires trust in client-side encryption

> This system is designed to **minimize data exposure and attack surface**, not to guarantee absolute anonymity.

---

## Cost

| Service | Cost |
|---------|------|
| Render (backend) | ₹0 |
| Redis | ₹0 |
| UptimeRobot | ₹0 |
| Domain (badri.online) | Already purchased |
| **Total** | **₹0/month** |

---

## API

```
GET /api/health → { "status": "ok", "connections": 0, "uptime": 123.45 }
```

---

## License

MIT
