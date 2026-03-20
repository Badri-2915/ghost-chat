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
React SPA (Vite + TailwindCSS)
     |
     v (WebSocket)
Socket.IO Client ←→ Socket.IO Server (Node.js + Express)
                            |
                            +── Room management (create/join/approve/reject)
                            +── Message relay (encrypted payloads)
                            +── Typing indicators
                            +── Delivery & read receipts
                            +── Panic delete (wipe all messages)
                            +── 3-state presence (active/inactive/offline)
                            +── Visibility & screenshot detection
                            +── Offline message buffering & delivery
                            |
                            v
                     Redis (gc: prefix)
                            +── Room state (TTL)
                            +── User presence
                            +── Join requests
                            +── Message metadata (TTL auto-expire)
                            +── Offline message buffer (30 min TTL)
                            +── Rate limiting counters
```

```
Message Flow:

Sender → encrypt(AES-GCM, roomKey) → Socket.IO emit → Server relay → Socket.IO broadcast
                                                                           ↓
Receiver ← decrypt(AES-GCM, roomKey) ← Socket.IO on ← all room members receive
                                                                           ↓
                                                              Auto-delete after TTL expires
```

---

## Features

| Feature | Description |
|---------|-------------|
| **Room-Based Chat** | Create or join rooms with 8-char secret codes |
| **Controlled Access** | Room creator approves/rejects join requests |
| **Real-Time Messaging** | Instant delivery via WebSockets (Socket.IO) |
| **End-to-End Encryption** | AES-GCM encryption with room-derived key (PBKDF2) |
| **Ephemeral Messages** | Auto-delete: after seen (3s), 5s, 15s, 30s, 1m, or 5m |
| **Reply Feature** | Swipe-to-reply (touch), double-click/long-press menu (Copy/Reply/Delete) |
| **Panic Button** | Instantly wipe all messages for all users in the room |
| **Toast Notifications** | Join requests with inline Accept/Reject buttons |
| **Typing Indicators** | See who's typing in real time |
| **Read Receipts** | Sent → Delivered → Read status tracking |
| **3-State Presence** | Active (green) / Inactive (gray, tab switched) / Offline (disconnected) |
| **Deep Link Sharing** | Share `https://badri.online/r/CODE` — auto-fills room code on open |
| **Creator Rejoin** | Room creator auto-approved on rejoin (no waiting screen) |
| **Offline Recovery** | Messages buffered in Redis while user is offline, delivered on rejoin |
| **Screenshot Awareness** | Best-effort <3s heuristic warns room members |
| **Rate Limiting** | Per-user message limits + per-IP connection limits |
| **Message Dedup** | Duplicate messages prevented on rejoin via messageId check |
| **No Duplicate Users** | Stale sessions cleaned on rejoin, single entry per username |
| **Room Code Trimming** | Whitespace-tolerant room code matching for manual entry |
| **Timer Privacy** | Ephemeral countdown visible only to sender, not receivers |
| **Connection Handling** | Disconnect overlay, auto-reconnect, online/offline detection |
| **Leave Room** | Clean exit with full state reset and server-side cleanup |
| **Scroll-to-Bottom** | Smart auto-scroll + manual scroll button when reading history |
| **No Data Storage** | No accounts, no databases, no persistent logs |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite 5 + TailwindCSS 3 |
| UI Icons | Lucide React |
| Backend | Node.js + Express + Socket.IO 4 |
| State & Cache | Redis (shared instance, `gc:` prefix, TTL-based) |
| Encryption | Web Crypto API (ECDH key exchange + AES-GCM + PBKDF2) |
| ID Generation | nanoid v3 (room codes) + uuid v9 (message IDs) |
| Hosting | Render (Docker, free tier) |
| Monitoring | UptimeRobot (5-min health pings) |
| Domain | badri.online (GoDaddy) |
| SEO | Google Search Console + sitemap.xml + robots.txt |

---

## Project Structure

```
ghost-chat/
├── render.yaml                          # Render Blueprint (web service + Redis)
├── Dockerfile                           # Multi-stage: Node builds frontend → serves with backend
├── docker-compose.yml                   # Local dev: backend + Redis
├── backend/
│   ├── src/
│   │   ├── index.js                     # Express + Socket.IO server, event registration
│   │   ├── redis.js                     # Redis client, gc: prefix, in-memory fallback
│   │   ├── rateLimiter.js               # Per-user message + per-IP connection limits
│   │   └── socket/
│   │       ├── rooms.js                 # Room create/join/approve/reject/disconnect
│   │       └── handlers.js              # Messages, typing, receipts, panic, visibility
│   ├── static/                          # Built frontend (production)
│   ├── test.js                          # Quick feature tests (48 assertions)
│   └── test-comprehensive.js            # Full test suite (151 assertions)
├── frontend/
│   ├── public/
│   │   ├── sitemap.xml                  # SEO sitemap for Google
│   │   └── robots.txt                   # Crawler instructions
│   ├── src/
│   │   ├── App.jsx                      # Root: Landing → WaitingRoom → ChatRoom
│   │   ├── main.jsx                     # React entry point
│   │   ├── index.css                    # Tailwind + custom animations
│   │   ├── context/
│   │   │   └── ChatContext.jsx          # All state + socket events + actions
│   │   ├── hooks/
│   │   │   └── useSocket.js             # Socket.IO connection hook
│   │   ├── crypto/
│   │   │   └── encryption.js            # ECDH, AES-GCM, PBKDF2 key derivation
│   │   └── components/
│   │       ├── Landing.jsx              # Create/Join room screen
│   │       ├── WaitingRoom.jsx          # Pending approval screen
│   │       ├── ChatRoom.jsx             # Main chat UI + panic button + reply bar
│   │       ├── MessageBubble.jsx        # Message display + swipe + long-press menu
│   │       ├── ToastContainer.jsx       # Toast notifications (join requests, alerts)
│   │       ├── TypingIndicator.jsx      # "X is typing..." display
│   │       ├── TimerSelector.jsx        # TTL picker (after seen, 5s, 15s, etc.)
│   │       ├── UserList.jsx             # Online users sidebar
│   │       └── JoinRequests.jsx         # Pending join requests sidebar
│   └── index.html                       # SEO meta tags, Open Graph, Twitter Card
└── docs/                                # (local) Project report + interview prep
```

---

## Local Development

### Prerequisites
- Node.js 20+
- Redis (local or Docker)

### Quick Start

```bash
# 1. Clone
git clone https://github.com/Badri-2915/ghost-chat.git
cd ghost-chat

# 2. Start Redis
docker run -d --name redis -p 6379:6379 redis:7-alpine

# 3. Backend
cd backend
cp .env.example .env    # Edit REDIS_URL if needed
npm install
npm run dev             # Runs on http://localhost:3001

# 4. Frontend (new terminal)
cd frontend
cp .env.example .env
npm install
npm run dev             # Runs on http://localhost:5173 (proxies to backend)
```

### Single-Origin Local Test

```bash
cd frontend && npm run build
cp -r dist ../backend/static
# Now http://localhost:3001 serves everything (like production)
```

### Using Docker

```bash
docker-compose up       # Backend + Redis
cd frontend && npm run dev   # Frontend dev server
```

---

## Testing

```bash
# Start server first, then:
cd backend
node test.js                  # Quick suite: 48 assertions
node test-comprehensive.js    # Full suite: 151 assertions
```

### Test Coverage (19 test suites, 151 assertions)

| Suite | Assertions | Covers |
|-------|------------|--------|
| Health & Server | 9 | API, SPA fallback, uptime, response time |
| Room Creation | 14 | Unique codes, user IDs, special chars, empty/long usernames |
| Join Request Flow | 13 | Approve, reject, invalid code, non-creator auth, auto-approve |
| Messaging | 17 | Send, receive, all TTL values, receipts, outsider block, edge cases |
| Reply Feature | 10 | Reply refs, chains, self-reply, null replyTo |
| Message Deletion | 5 | Single delete, multi-delete, non-existent, outsider |
| Panic Delete | 6 | Creator/joiner trigger, empty room, rapid, outsider |
| Typing Indicators | 8 | Start/stop, rapid, outsider, simultaneous |
| Rate Limiting | 4 | Connection/message limits, burst under limit |
| Presence & Disconnect | 6 | User left, creator left, multi-leave, pending disconnect |
| 3-State Presence | 7 | Active/inactive broadcast, rapid toggles, creator state |
| Visibility & Screenshot | 10 | Hide/show, screenshot warning, rapid, outsider, creator |
| Creator Rejoin & No Duplicates | 5 | Auto-approve, no duplicate users, whitespace-padded code |
| Offline Message Recovery | 6 | Missed messages, creator rejoin + missed, content order |
| Room Code Trimming | 4 | Whitespace join, whitespace rejoin, empty-after-trim |
| Edge Cases & Stability | 9 | Unicode, 10K chars, burst 20 msgs, post-disconnect, concurrent ops |
| Multiple Users & Concurrency | 8 | 3-user broadcast, cross-room isolation, concurrent creation |
| Clean Exit | 3 | Leave notification, Redis cleanup, graceful disconnect |

---

## Socket.IO Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `create-room` | Client → Server | Create a new chat room |
| `room-created` | Server → Client | Room created with code + userId |
| `join-request` | Client → Server | Request to join a room |
| `join-requested` | Server → Client | Acknowledgment of join request |
| `join-requests-updated` | Server → Creator | New pending join request |
| `approve-join` / `reject-join` | Creator → Server | Accept/reject join request |
| `join-approved` / `join-rejected` | Server → Joiner | Result of join request |
| `send-message` | Client → Server | Send encrypted message (+ optional replyTo) |
| `new-message` | Server → Room | Broadcast message to all room members |
| `delete-message` | Client → Server | Delete a specific message |
| `message-deleted` | Server → Room | Message deleted notification |
| `panic-delete` | Client → Server | Wipe all messages in room |
| `panic-delete` | Server → Room | All messages wiped notification |
| `typing-start` / `typing-stop` | Client → Server | Typing indicator |
| `user-typing` / `user-stopped-typing` | Server → Room | Typing broadcast |
| `message-delivered` / `message-read` | Client → Server | Delivery/read receipt |
| `message-status-update` | Server → Sender | Status update (delivered/read) |
| `visibility-change` | Client → Server | Tab visible/hidden |
| `user-visibility-changed` | Server → Room | User visibility broadcast |
| `user_inactive` | Client → Server | User switched tab (3-state) |
| `user_active` | Client → Server | User returned to tab (3-state) |
| `user-state-changed` | Server → Room | Broadcast active/inactive state |
| `screenshot-warning` | Client → Server | Screenshot detected (<3s heuristic) |
| `screenshot-warning` | Server → Room | Screenshot warning broadcast |
| `rejoin-room` | Client → Server | Rejoin after disconnect (delivers missed msgs) |
| `user-rejoined` | Server → Room | User reconnected notification |
| `users-updated` | Server → Room | Online users list changed |
| `user-left` | Server → Room | User disconnected |
| `error-message` | Server → Client | Error notification |

---

## Encryption Design

```
Room Creation:
  roomCode (8 chars) → PBKDF2 → roomKey (AES-256)

Sending a Message:
  plaintext → AES-GCM encrypt(roomKey, random IV) → { iv, ciphertext } → Socket.IO emit

Receiving a Message:
  { iv, ciphertext } → AES-GCM decrypt(roomKey, iv) → plaintext

Key Exchange (future):
  Each user generates ECDH key pair → exchange public keys → derive shared secret
```

- Server **never** sees plaintext — only relays encrypted payloads
- Room key derived from room code via PBKDF2 (256-bit, 100K iterations)
- Each message encrypted with a fresh random IV (96-bit)

---

## Capacity & Scalability

### Realistic Limits (Render Free Tier)

| Metric | Estimate | Bottleneck |
|--------|----------|-----------|
| Concurrent users (total) | ~50–100 | Render free tier memory (512 MB) |
| Users per room | ~20 | Socket.IO broadcast fan-out |
| Active rooms | ~50 simultaneous | Redis memory (25 MB free) |
| Messages per minute | ~500 total | Rate limit: 30/user/min |
| Average message size | ~300–500 bytes | Encrypted payload + metadata |

### Storage Design — No Database

Ghost Chat **intentionally has no permanent storage**:

- **No SQL database** (no PostgreSQL, MySQL, SQLite)
- **No NoSQL database** (no MongoDB, DynamoDB)
- **No file storage** (no S3, no disk writes)
- **Only Redis** — used purely as a temporary cache with TTL-based auto-expiry

Every piece of data has a time-to-live:

| Data | TTL | What happens when it expires |
|------|-----|------------------------------|
| Room metadata | 6 hours | Room ceases to exist |
| User presence | 6 hours | User entry removed |
| Join requests | 30 minutes | Request auto-rejected |
| Messages | 3s – 5m (user-selected) | Message permanently deleted |
| Missed msg buffer | 30 minutes | Offline messages cleared |
| Rate limit counters | 60 seconds | Counter resets |

**If Redis restarts, all data is lost — by design.** There is nothing to recover, nothing to back up, and nothing to breach.

### Why This Matters

- **No data accumulation** — storage usage stays near-constant regardless of how long the app runs
- **No cleanup scripts** — Redis handles all expiration natively
- **No scaling headaches** — there's no growing database to manage
- **Privacy by architecture** — even a server compromise reveals nothing (E2EE + no persistent data)

### Scaling Beyond Free Tier

| Change | Enables |
|--------|---------|
| Render paid tier ($7/mo) | ~500 concurrent users, dedicated resources |
| Socket.IO Redis adapter | Horizontal scaling across multiple Node.js processes |
| Redis Cluster | Higher memory, better throughput |
| Cloudflare CDN (free) | Faster static asset delivery worldwide |

The architecture is designed to scale — but the current deployment is right-sized for its purpose: small, private rooms.

---

## Security & Privacy

### What this system does:
- Encrypts messages client-side (AES-GCM) before sending
- Server only relays opaque encrypted data
- No permanent message storage — Redis TTL auto-expires everything
- No user accounts, no emails, no personal data
- Messages auto-delete from all clients and server
- Rate limiting prevents spam and abuse (30 msgs/min, 200 conn/min)
- Tab detection warns when users switch away
- Screenshot detection (best-effort) warns room members
- Connection loss overlay with auto-reconnect
- Leave room functionality with full state cleanup

### Honest Limitations:
- Cannot prevent network-level metadata visibility (IP addresses)
- Cannot fully prevent screenshots on all devices
- Messages are permanently lost after deletion (by design)
- Room key is derived from room code — anyone with the code can decrypt
- Requires trust in client-side encryption implementation
- Single-server deployment (no horizontal scaling currently)
- Free tier cold starts (~30s after 15 min inactivity, mitigated by UptimeRobot)

> Designed to **minimize data exposure and attack surface**, not to guarantee absolute anonymity. Scales with infrastructure, not unlimited.

---

## Production Deployment (Render)

1. Push repo to GitHub
2. Go to [render.com](https://render.com) → **New +** → **Blueprint**
3. Connect your repo → Render reads `render.yaml`
4. Fill in environment variables (REDIS_URL is auto-set by the blueprint)
5. Deploy → get `https://ghost-chat-broc.onrender.com`
6. **Settings → Custom Domains** → add `badri.online`
7. Add DNS records on GoDaddy as shown by Render
8. Set up UptimeRobot: `https://badri.online/api/health` every 5 minutes

See [SETUP_GUIDE.md](./SETUP_GUIDE.md) for detailed step-by-step instructions.

---

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check (status, connections, uptime) |

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
| `docs/INTERVIEW-PREP.md` | Local only | Interview preparation document (40 sections) |

---

## License

MIT
