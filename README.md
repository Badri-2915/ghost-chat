# Ghost Chat — Privacy-First Ephemeral Messaging

A real-time, end-to-end encrypted chat application with self-destructing messages. No sign-up, no database, no persistent data. Create a room, share the code, and chat — messages vanish automatically.

**Live:** [https://badri.online](https://badri.online)

```
https://badri.online              Landing page (Create / Join room)
https://badri.online/r/ABC123     Deep link — auto-fills room code for joining
https://badri.online/api/health   Health check endpoint
```

---

## Architecture

```
User (Browser)
     |
     v
React 18 SPA (Vite + TailwindCSS)
     |
     v (WebSocket — Socket.IO)
Socket.IO Client ←→ Socket.IO Server (Node.js + Express)
                            |
                            +── Room lifecycle (create/join/approve/reject/destroy)
                            +── Message relay (encrypted payloads, never decrypted by server)
                            +── Typing indicators (start/stop, debounced)
                            +── Delivery & read receipts (sent → delivered → read)
                            +── Panic delete (instant wipe for all users)
                            +── 3-state presence (active / inactive / offline)
                            +── Tab visibility awareness (user_inactive / user_active)
                            +── Delete permissions (sender-only + creator moderation)
                            +── Creator identity via creatorToken (not username)
                            +── Offline grace period (5 min before user removed)
                            |
                            v
                     Redis (gc: prefix, TTL-based)
                            +── Room metadata (6h TTL)
                            +── User presence map
                            +── Pending join requests (30min TTL)
                            +── Message metadata (per-message TTL: 3s–5m)
                            +── Rate limiting counters (60s TTL)
```

```
Message Flow:

Sender → encrypt(AES-GCM, roomKey) → Socket.IO emit('send-message')
                                              ↓
                                    Server validates + relays
                                              ↓
                              Socket.IO broadcast('new-message') → All room members
                                              ↓
Receiver ← decrypt(AES-GCM, roomKey) ← receives encrypted payload
                                              ↓
                                    TTL countdown begins → auto-delete fires
```

---

## Features

| Feature | Description |
|---------|-------------|
| **Room-Based Chat** | Create or join rooms with 8-char secret codes |
| **Controlled Access** | Room creator approves/rejects every join request |
| **Real-Time Messaging** | Instant delivery via WebSockets (Socket.IO) |
| **End-to-End Encryption** | AES-GCM encryption with room-derived key (PBKDF2, 100K iterations) |
| **Ephemeral Messages** | Auto-delete: after seen (3s delay), 5s, 15s, 30s, 1m, or 5m |
| **Reply Feature** | Swipe-to-reply (touch), long-press/double-click menu (Copy/Reply/Delete) |
| **Panic Button** | Two-click confirmation → instantly wipe all messages for all users |
| **Toast Notifications** | Join requests with inline Accept/Reject buttons for creator |
| **Typing Indicators** | See who's typing in real time (2s debounce) |
| **Read Receipts** | Sent → Delivered → Read (IntersectionObserver-based) |
| **3-State Presence** | Active (green) / Inactive (grey, tab hidden) / Offline (disconnected) |
| **Deep Link Sharing** | Share `https://badri.online/r/CODE` — auto-fills join form on open |
| **Creator Rejoin** | Creator auto-approved via secret `creatorToken` (not by username) |
| **Creator Absence** | Join blocked when creator is offline — prevents unsupervised access |
| **Room Auto-Destruction** | Empty rooms fully destroyed — all Redis keys cleaned immediately |
| **Delete Permissions** | Sender deletes own messages; creator can moderate any message |
| **Message Length Limit** | Max 5000 characters per message (server enforced) |
| **Rate Limiting** | 30 messages/min per user + 200 connections/min per IP |
| **Message Dedup** | Duplicate messages prevented via messageId check |
| **No Duplicate Users** | Stale sessions cleaned on rejoin, one entry per userId |
| **Room Code Trimming** | Whitespace-tolerant room code matching for manual entry |
| **Timer Privacy** | TTL countdown shown only to sender — hidden from recipients |
| **Disconnect Overlay** | Blocks UI during reconnect, auto-reconnects on network restore |
| **Session Persistence** | sessionStorage auto-rejoins on refresh; localStorage preserves creatorToken |
| **Leave Room** | Clean exit with server-side cleanup + full state reset |
| **Scroll-to-Bottom** | Smart auto-scroll + "N new messages" button when reading history |
| **No Data Storage** | No accounts, no databases, no persistent logs — ever |

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend framework | React 18 + Vite 5 | SPA, fast builds, HMR in dev |
| Styling | TailwindCSS 3 | Utility-first CSS, custom design tokens |
| UI Icons | Lucide React | Consistent SVG icon set |
| Backend runtime | Node.js 20 + Express 4 | HTTP server, static serving, REST endpoints |
| WebSockets | Socket.IO 4 | Bidirectional real-time events, auto-reconnect |
| Cache / State | Redis 7 (`gc:` prefix, TTL auto-expiry) | Ephemeral room/user/message data |
| Encryption | Web Crypto API (AES-GCM + PBKDF2) | Client-side E2EE, server never sees plaintext |
| ID Generation | nanoid v3 | Room codes (8), user IDs (12), creator tokens (16) |
| Message IDs | uuid v9 | 21-char unique message identifiers |
| Hosting | Render (Docker, free tier) | Containerised deployment |
| Monitoring | UptimeRobot (5-min pings) | Prevents free-tier cold starts |
| Domain | badri.online (GoDaddy + Render DNS) | Custom domain with SSL |
| SEO | Google Search Console + sitemap.xml + robots.txt | Indexing |

---

## Project Structure

```
ghost-chat/
├── render.yaml                          # Render Blueprint (web service + Redis)
├── Dockerfile                           # Multi-stage: build frontend → serve with backend
├── docker-compose.yml                   # Local dev: backend + Redis side-by-side
├── backend/
│   ├── src/
│   │   ├── index.js                     # Express server + Socket.IO setup + event registration
│   │   ├── redis.js                     # Redis client + in-memory fallback + all data helpers
│   │   ├── rateLimiter.js               # Per-user message + per-IP connection rate limits
│   │   └── socket/
│   │       ├── rooms.js                 # Room create/join/approve/reject/disconnect lifecycle
│   │       └── handlers.js              # Messages, typing, receipts, panic, visibility
│   ├── static/                          # Built frontend (committed, served by Express in prod)
│   ├── test.js                          # Quick feature tests (46 assertions)
│   └── test-comprehensive.js            # Full test suite (165 assertions)
├── frontend/
│   ├── public/
│   │   ├── sitemap.xml                  # SEO sitemap for Google indexing
│   │   └── robots.txt                   # Crawler instructions
│   ├── src/
│   │   ├── App.jsx                      # Root component: Landing → WaitingRoom → ChatRoom
│   │   ├── main.jsx                     # React 18 entry point (ReactDOM.createRoot)
│   │   ├── index.css                    # Tailwind directives + custom animations + tokens
│   │   ├── context/
│   │   │   └── ChatContext.jsx          # All global state + socket events + action functions
│   │   ├── hooks/
│   │   │   └── useSocket.js             # Socket.IO connection hook with reconnect logic
│   │   ├── crypto/
│   │   │   └── encryption.js            # AES-GCM encrypt/decrypt + PBKDF2 key derivation
│   │   └── components/
│   │       ├── Landing.jsx              # Create/Join room entry screen + deep link detection
│   │       ├── WaitingRoom.jsx          # Pending approval screen shown after join request
│   │       ├── ChatRoom.jsx             # Main chat UI: messages, input, sidebar, panic button
│   │       ├── MessageBubble.jsx        # Single message: TTL countdown, receipts, swipe, menu
│   │       ├── ToastContainer.jsx       # Floating toast notifications (join requests, alerts)
│   │       ├── TypingIndicator.jsx      # "X is typing..." animated dots display
│   │       ├── TimerSelector.jsx        # TTL picker: after-seen / 5s / 15s / 30s / 1m / 5m
│   │       ├── UserList.jsx             # Sidebar: room members with 3-state presence dots
│   │       └── JoinRequests.jsx         # Sidebar: pending join requests (creator only)
│   └── index.html                       # HTML shell with SEO meta, Open Graph, Twitter Card
└── docs/                                # Local only — project report + interview prep
```

---

## Local Development

### Prerequisites
- Node.js 20+
- Redis (local install or Docker)

### Quick Start

```bash
# 1. Clone
git clone https://github.com/Badri-2915/ghost-chat.git
cd ghost-chat

# 2. Start Redis
docker run -d --name redis -p 6379:6379 redis:7-alpine

# 3. Backend
cd backend
cp .env.example .env    # Set REDIS_URL=redis://localhost:6379 if needed
npm install
npm run dev             # Runs on http://localhost:3001

# 4. Frontend (new terminal)
cd frontend
cp .env.example .env    # Set VITE_API_URL=http://localhost:3001
npm install
npm run dev             # Runs on http://localhost:5173 (proxied to backend)
```

### Single-Origin Local Test (matches production behaviour)

```bash
cd frontend
npm run build
cp -r dist/* ../backend/static/
# Now http://localhost:3001 serves everything from one origin
```

### Using Docker Compose

```bash
docker-compose up         # Starts backend + Redis
cd frontend && npm run dev  # Start frontend dev server separately
```

### Environment Variables

| Variable | Where | Description |
|----------|-------|-------------|
| `REDIS_URL` | backend `.env` | Redis connection string (default: `redis://localhost:6379`) |
| `PORT` | backend `.env` | HTTP server port (default: `3001`) |
| `VITE_API_URL` | frontend `.env` | Backend URL for Socket.IO (default: empty = same origin) |

---

## Build Pipeline

```
Development:
  frontend/npm run dev  →  Vite HMR dev server (port 5173)
                               ↓ proxies /socket.io → backend (port 3001)

Production build:
  frontend/npm run build  →  frontend/dist/
  cp -r dist/* ../backend/static/
  backend serves static/ via Express for all non-API routes

Docker (Render):
  Stage 1: node:20-alpine  →  builds frontend → /frontend/dist
  Stage 2: node:20-alpine  →  copies dist to ./static, runs backend
```

> **Critical:** Never change `vite.config.js` `outDir` to `../backend/static/` — this breaks the Docker multi-stage build. Always build to `dist/` and copy manually for local testing.

---

## Socket.IO Events Reference

| Event | Direction | Description |
|-------|-----------|-------------|
| `create-room` | Client → Server | Create a new room; server generates 8-char code |
| `room-created` | Server → Client | Room created — returns `{ roomCode, userId, creatorToken }` |
| `join-request` | Client → Server | Request to join a room by code |
| `join-requested` | Server → Client | Acknowledgment of join request (go to WaitingRoom) |
| `join-requests-updated` | Server → Creator | New pending request arrived |
| `approve-join` | Creator → Server | Accept a join request |
| `reject-join` | Creator → Server | Reject a join request |
| `join-approved` | Server → Joiner | Request approved — enter room |
| `join-rejected` | Server → Joiner | Request rejected — return to landing |
| `rejoin-room` | Client → Server | Rejoin after reconnect (creatorToken for creator) |
| `user-rejoined` | Server → Room | User reconnected (emitted before users-updated) |
| `users-updated` | Server → Room | Full user list changed |
| `user-left` | Server → Room | User disconnected |
| `send-message` | Client → Server | Send encrypted message + TTL + optional replyTo |
| `new-message` | Server → Room | Broadcast encrypted message to all members |
| `delete-message` | Client → Server | Delete a single message (sender or creator only) |
| `message-deleted` | Server → Room | Single message deleted notification |
| `panic-delete` | Client → Server | Wipe ALL messages in the room |
| `panic-delete` | Server → Room | All messages wiped — clear local list |
| `typing-start` | Client → Server | User started typing |
| `typing-stop` | Client → Server | User stopped typing |
| `user-typing` | Server → Room | Broadcast typing started (excludes sender) |
| `user-stopped-typing` | Server → Room | Broadcast typing stopped |
| `message-delivered` | Client → Server | Message received by recipient's client |
| `message-read` | Client → Server | Message scrolled into view (IntersectionObserver) |
| `message-status-update` | Server → Sender | Status changed to delivered or read |
| `visibility-change` | Client → Server | Browser tab became visible/hidden |
| `user-visibility-changed` | Server → Room | Broadcast tab visibility change |
| `user_inactive` | Client → Server | User switched to another tab |
| `user_active` | Client → Server | User returned to this tab |
| `user-state-changed` | Server → Room | Active/inactive state broadcast |
| `leave-room` | Client → Server | User explicitly left the room |
| `error-message` | Server → Client | Error notification (room not found, rate limited, etc.) |

---

## Encryption Design

```
Key Derivation:
  roomCode (8 chars, ASCII)
    → PBKDF2(SHA-256, iterations=100000, salt='ghost-chat-salt', keyLen=256)
    → roomKey (AES-256-GCM CryptoKey)

Sending a Message:
  plaintext (UTF-8 string)
    → TextEncoder → Uint8Array
    → AES-GCM encrypt(roomKey, iv=crypto.getRandomValues(12 bytes))
    → { iv: base64, ciphertext: base64 }
    → Socket.IO emit('send-message', { content: { iv, ciphertext }, ... })

Receiving a Message:
  { iv: base64, ciphertext: base64 }
    → base64 decode
    → AES-GCM decrypt(roomKey, iv)
    → Uint8Array → TextDecoder → plaintext string

Server role: relay only — never accesses plaintext, never stores ciphertext permanently
```

**Key properties:**
- Room key derived from room code — anyone with the code can decrypt
- Fresh random 96-bit IV per message — prevents IV reuse attacks
- PBKDF2 with 100,000 iterations — makes brute-force on room codes expensive
- Server stores nothing — encrypted payload is relayed and discarded

---

## Session Persistence

```
sessionStorage (key: 'gc_session')
  Stores: { screen, username, roomCode, userId, isCreator, creatorToken }
  Cleared by: leaveRoom()
  Used for: auto-rejoin on page refresh / network reconnect

localStorage (key: 'gc_ct_ROOMCODE')
  Stores: creatorToken (survives leave and browser close)
  Never cleared automatically
  Used for: creator can rejoin and reclaim creator role even after leaving
```

On every socket `connect` event, if `gc_session` exists, the client emits `rejoin-room` automatically. The server verifies creatorToken (if provided) and grants creator status if it matches.

---

## Presence System (3-State)

| State | Trigger | Visual |
|-------|---------|--------|
| **active** | Tab focused, socket connected | Green dot |
| **inactive** | Tab hidden (`document.visibilityState === 'hidden'`) | Grey dot |
| **offline** | Socket disconnected (pingTimeout: 20s or `beforeunload`) | Red dot |

```
Tab switch:    client emits user_inactive → server broadcasts user-state-changed(inactive)
Tab return:    client emits user_active   → server broadcasts user-state-changed(active)
Disconnect:    server emits user-left + user-state-changed(offline) immediately
               5-minute grace timer starts → if no rejoin, user removed from room
Page close:    navigator.sendBeacon('/api/leave') → instant offline before socket times out
```

---

## Rate Limiting

| Limit | Value | Scope |
|-------|-------|-------|
| Messages | 30 per minute | Per userId |
| Connections | 200 per minute | Per IP address |

Redis is used as the counter store with 60-second TTL keys. Falls back to an in-memory Map if Redis is unavailable.

```
Redis key pattern:
  rl:msg:{userId}   → message count (expires in 60s)
  rl:con:{ip}       → connection count (expires in 60s)
```

---

## Redis Data Model

All keys use the `gc:` prefix (shared Redis instance with other apps).

| Key | Type | TTL | Contents |
|-----|------|-----|----------|
| `gc:room:{code}` | Hash | 6 hours | `{ creator, creatorToken, createdAt }` |
| `gc:room:{code}:users` | Hash | 6 hours | `{ [userId]: username }` |
| `gc:room:{code}:pending` | Hash | 30 min | `{ [userId]: username }` — join requests |
| `gc:msg:{msgId}` | String | per-TTL | Message metadata JSON |
| `gc:rl:msg:{userId}` | String | 60s | Message rate limit counter |
| `gc:rl:con:{ip}` | String | 60s | Connection rate limit counter |

When a room becomes empty (last user disconnects after grace period), `destroyRoom()` deletes all `gc:room:{code}*` and `gc:msg:*` keys atomically.

---

## Testing

```bash
# Start server first (backend must be running on port 3001)
cd backend

node test.js                  # Quick suite: 46 assertions (~5s)
node test-comprehensive.js    # Full suite: 165 assertions (~30s)
```

### Test Coverage (24 suites, 165 assertions)

| Suite | Assertions | Covers |
|-------|------------|--------|
| Health & Server | 9 | API endpoints, SPA fallback, response time |
| Room Creation | 14 | Unique codes, user IDs, special chars, edge cases |
| Join Request Flow | 13 | Approve, reject, invalid code, non-creator auth |
| Messaging | 17 | Send, receive, all TTL values, receipts, outsider block |
| Reply Feature | 10 | Reply refs, chains, self-reply, null replyTo |
| Message Deletion | 5 | Single delete, multi-delete, non-existent, outsider |
| Panic Delete | 6 | Creator/joiner trigger, empty room, rapid, outsider |
| Typing Indicators | 8 | Start/stop, rapid, outsider, simultaneous |
| Rate Limiting | 4 | Connection/message limits, burst under limit |
| Presence & Disconnect | 6 | User left, creator left, multi-leave, pending disconnect |
| 3-State Presence | 7 | Active/inactive broadcast, rapid toggles, creator state |
| Visibility | 6 | Hide/show, rapid, outsider, creator |
| Delete Permissions | 4 | Sender-only, creator moderation, non-sender rejected |
| Message Constraints | 4 | Max 5000 chars, oversized rejected, empty ok |
| Creator Rejoin & No Duplicates | 5 | Auto-approve, no duplicate users, whitespace code |
| Room Code Trimming | 4 | Whitespace join/rejoin, empty-after-trim |
| Rejoin Active State | 2 | User broadcasts active on rejoin, no stale inactive |
| Creator Identity & Absence | 5 | creatorToken verify, imposter blocked, absent blocked |
| Room Auto-Destruction | 3 | Empty rooms destroyed, all Redis data cleaned |
| Edge Cases & Stability | 9 | Unicode, long msgs, burst 20 msgs, concurrent ops |
| Multiple Users & Concurrency | 8 | 3-user broadcast, cross-room isolation |
| Clean Exit | 3 | Leave notification, Redis cleanup, graceful disconnect |

---

## Capacity & Scalability

### Realistic Limits (Render Free Tier)

| Metric | Estimate | Bottleneck |
|--------|----------|-----------|
| Concurrent users (total) | ~50–100 | Render free tier memory (512 MB) |
| Users per room | ~20 | Socket.IO broadcast fan-out |
| Active rooms | ~50 simultaneously | Redis memory (25 MB free tier) |
| Messages per minute (total) | ~500 | Rate limit: 30/user/min |
| Average message size | ~300–500 bytes | AES-GCM ciphertext + metadata |

### Storage Design — No Database

Ghost Chat **intentionally has no permanent storage**:

- **No SQL database** (no PostgreSQL, MySQL, SQLite)
- **No NoSQL database** (no MongoDB, DynamoDB)
- **No file storage** (no S3, no disk writes)
- **Only Redis** — temporary cache with TTL-based auto-expiry

| Data | TTL | What happens when it expires |
|------|-----|------------------------------|
| Room metadata | 6 hours | Room ceases to exist |
| User presence map | 6 hours | Users cleared |
| Join requests | 30 minutes | Request auto-cancelled |
| Messages (timed TTL) | 5s – 5m | Message permanently deleted from all clients |
| Messages (after-seen) | ~3s after read | Message deleted after recipient reads it |
| Rate limit counters | 60 seconds | Counter resets, limiting window slides |

**If Redis restarts, all data is lost — by design.**

### Scaling Beyond Free Tier

| Change | Enables |
|--------|---------|
| Render paid tier ($7/mo) | ~500 concurrent users, dedicated resources |
| Socket.IO Redis adapter | Horizontal scaling (multiple Node.js processes) |
| Redis Cluster | Higher throughput, more memory |
| Cloudflare CDN (free) | Faster static asset delivery worldwide |

---

## Security & Privacy

### What this system does:
- Encrypts all messages client-side (AES-GCM) before transmitting
- Server only relays opaque encrypted blobs — never accesses plaintext
- No permanent message storage — Redis TTL auto-expires everything
- No user accounts, no emails, no personal data collected
- Messages auto-delete from every client and the server simultaneously
- Rate limiting: 30 msgs/min per user, 200 connections/min per IP
- **Creator identity secured by `creatorToken`** — 16-char secret, not username
- Join blocked when creator is absent — no unsupervised room access
- **Room auto-destruction** — empty rooms fully cleaned (all Redis keys removed)
- Delete permissions: sender deletes own messages; creator moderates all
- 5-minute offline grace period — reconnect window before user is removed

### Honest Limitations:
- Room key derived from room code — anyone with the code can decrypt messages
- Cannot prevent network-level metadata visibility (IP addresses visible to server)
- Cannot prevent screenshots (screenshot detection is not feasible in web apps)
- Requires trust in the client-side encryption implementation
- Single-server deployment currently (no horizontal scaling)
- Free tier cold starts (~30s after 15 min inactivity, mitigated by UptimeRobot)
- Room destruction is final — no recovery once empty room timer fires

> Designed to **minimise data exposure and attack surface**, not to guarantee absolute anonymity.

---

## Production Deployment (Render)

1. Push repo to GitHub
2. Go to [render.com](https://render.com) → **New +** → **Blueprint**
3. Connect your repo → Render reads `render.yaml` automatically
4. `REDIS_URL` is auto-configured by the Blueprint's Redis service
5. Deploy → get `https://ghost-chat-xxxx.onrender.com`
6. **Settings → Custom Domains** → add `badri.online`
7. Add DNS records on GoDaddy as shown by Render (CNAME/A record)
8. Set up UptimeRobot: monitor `https://badri.online/api/health` every 5 minutes

See [SETUP_GUIDE.md](./SETUP_GUIDE.md) for detailed step-by-step instructions.

---

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check (status, connections, uptime) |
| POST | `/api/leave` | Instant offline signal (called via `sendBeacon` on page close) |

```bash
curl https://badri.online/api/health
```
```json
{
  "status": "ok",
  "connections": 3,
  "uptime": 12345.67
}
```

---

## Monthly Cost

| Service | Cost |
|---------|------|
| Render (web service) | ₹0 (free tier) |
| Render (Redis) | ₹0 (free tier, shared with 2goi.in) |
| UptimeRobot | ₹0 (free, 50 monitors) |
| Google Search Console | ₹0 |
| Domain (badri.online) | Already purchased |
| **Total** | **₹0/month** |

---

## Documentation

| Document | Location | Description |
|----------|----------|-------------|
| [README.md](./README.md) | GitHub | This file — overview, setup, architecture |
| [SETUP_GUIDE.md](./SETUP_GUIDE.md) | GitHub | Step-by-step deployment guide |
| `docs/PROJECT-REPORT.md` | Local only | Complete project report (~200 pages) |
| `docs/INTERVIEW-PREP.md` | Local only | Interview preparation document (~60 pages) |

---

## License

MIT
