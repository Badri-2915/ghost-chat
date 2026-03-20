# Ghost Chat — Setup & Deployment Guide

Complete step-by-step instructions for setting up Ghost Chat locally, deploying to Render, configuring DNS, monitoring, and SEO.

---

## Table of Contents

1. [Local Development Setup](#1-local-development-setup)
2. [Docker Setup](#2-docker-setup)
3. [Production Build](#3-production-build)
4. [Render Deployment](#4-render-deployment)
5. [Custom Domain (GoDaddy)](#5-custom-domain-godaddy)
6. [UptimeRobot (Keep Alive)](#6-uptimerobot-keep-alive)
7. [Google Search Console (SEO)](#7-google-search-console-seo)
8. [Redis Configuration](#8-redis-configuration)
9. [Environment Variables](#9-environment-variables)
10. [Running Tests](#10-running-tests)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Local Development Setup

### Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **Redis** — via Docker or local install
- **Git** — for cloning the repository

### Step-by-Step

```bash
# Clone the repository
git clone https://github.com/Badri-2915/ghost-chat.git
cd ghost-chat

# Start Redis (using Docker)
docker run -d --name redis -p 6379:6379 redis:7-alpine

# Setup backend
cd backend
cp .env.example .env
# Edit .env if your Redis is not at localhost:6379
npm install
npm run dev
# Server starts on http://localhost:3001

# Setup frontend (new terminal)
cd frontend
cp .env.example .env
npm install
npm run dev
# Dev server starts on http://localhost:5173
# Vite proxies /socket.io requests to localhost:3001
```

### Verify It Works

1. Open `http://localhost:5173` in your browser
2. Click "Create Room" → enter a name → you should get a room code
3. Open a second browser tab → "Join Room" → enter the code
4. The creator should see a join request → approve it
5. Both users can now chat

---

## 2. Docker Setup

```bash
# From project root
docker-compose up -d

# This starts:
# - Backend on port 3001
# - Redis on port 6379

# Start frontend dev server separately
cd frontend
npm install
npm run dev
```

### docker-compose.yml

The `docker-compose.yml` in the repo root defines:
- **backend** service: Node.js server on port 3001
- **redis** service: Redis 7 Alpine on port 6379

---

## 3. Production Build

To test production mode locally (single-origin, like Render):

```bash
# Build frontend
cd frontend
npm run build

# Copy build to backend static folder
cp -r dist ../backend/static

# Start backend (serves everything)
cd ../backend
node src/index.js

# Open http://localhost:3001 — full app served from one origin
```

---

## 4. Render Deployment

### Using Render Blueprint (Recommended)

1. **Push your code to GitHub**
   ```bash
   git push origin main
   ```

2. **Go to Render Dashboard**
   - Visit [dashboard.render.com](https://dashboard.render.com)
   - Click **New +** → **Blueprint**

3. **Connect your GitHub repo**
   - Select `Badri-2915/ghost-chat`
   - Render automatically reads `render.yaml`

4. **Render creates these services:**
   - **ghost-chat** — Web service (Node.js backend + static frontend)
   - **ghost-chat-redis** — Redis instance (or uses existing shared Redis)

5. **Environment variables are auto-configured** from `render.yaml`:
   - `REDIS_URL` — automatically set from the Redis service
   - `NODE_ENV` — set to `production`

6. **Wait for deployment** — usually 2–5 minutes

7. **Your app is live at:**
   ```
   https://ghost-chat-broc.onrender.com
   ```

### Manual Render Setup (Alternative)

If you prefer not to use Blueprint:

1. **Create a Web Service**
   - Runtime: Node
   - Build command: `cd frontend && npm install && npm run build && cp -r dist ../backend/static && cd ../backend && npm install`
   - Start command: `cd backend && node src/index.js`
   - Root directory: (leave blank)

2. **Create a Redis instance** (or use existing)

3. **Add environment variable:**
   - `REDIS_URL` = the internal Redis URL from Render

---

## 5. Custom Domain (GoDaddy)

### Add Custom Domain in Render

1. Go to your Render service → **Settings** → **Custom Domains**
2. Click **Add Custom Domain**
3. Enter: `badri.online`
4. Render shows you DNS records to configure

### Configure DNS in GoDaddy

1. Log in to [GoDaddy](https://dcc.godaddy.com)
2. Go to **DNS Management** for `badri.online`
3. Add/update these records:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| CNAME | `@` | `ghost-chat-broc.onrender.com` | 600 |

Or if GoDaddy doesn't allow CNAME for root (`@`):

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `@` | (Render's IP, shown in dashboard) | 600 |
| CNAME | `www` | `ghost-chat-broc.onrender.com` | 600 |

4. Wait 5–30 minutes for DNS propagation
5. Render automatically provisions an SSL certificate (HTTPS)

### Verify

```bash
curl -I https://badri.online
# Should return HTTP/2 200
```

---

## 6. UptimeRobot (Keep Alive)

Render's free tier **puts the service to sleep after 15 minutes of inactivity**. First request after sleep takes 30–60 seconds (cold start).

### Setup UptimeRobot

1. Create a free account at [uptimerobot.com](https://uptimerobot.com)
2. Click **Add New Monitor**
3. Configure:
   - **Monitor Type:** HTTP(s)
   - **Friendly Name:** Ghost Chat
   - **URL:** `https://badri.online/api/health`
   - **Monitoring Interval:** 5 minutes
4. Click **Create Monitor**

### What This Does

- UptimeRobot sends a real HTTP GET request every 5 minutes
- This keeps the Render container warm (prevents sleep)
- Bonus: UptimeRobot sends you email alerts if the site goes down
- Free tier allows up to 50 monitors

---

## 7. Google Search Console (SEO)

### Verify Domain Ownership

1. Go to [Google Search Console](https://search.google.com/search-console)
2. Click **Add Property** → select **Domain** → enter `badri.online`
3. Google gives you a TXT record to verify ownership
4. Go to GoDaddy DNS → Add a **TXT record**:
   - **Name:** `@`
   - **Value:** `google-site-verification=YOUR_CODE_HERE`
   - **TTL:** 600
5. Wait 5–10 minutes → click **Verify** in Search Console

### Submit Sitemap

1. In Search Console → **Sitemaps** (left sidebar)
2. Enter: `https://badri.online/sitemap.xml`
3. Click **Submit**

### Request Indexing

1. In Search Console → **URL Inspection** (top bar)
2. Enter: `https://badri.online/`
3. Click **Request Indexing**
4. Google will crawl and index your site within 24–48 hours

### What's Already Configured

The codebase includes:
- `frontend/public/sitemap.xml` — lists all pages
- `frontend/public/robots.txt` — allows all crawlers
- `frontend/index.html` — has meta title, description, keywords, Open Graph, Twitter Card tags

---

## 8. Redis Configuration

### Shared Redis Instance

Ghost Chat shares a Redis instance with 2goi.in. To avoid key collisions:
- All Ghost Chat keys use the prefix `gc:`
- Example: `gc:room:ABC12345`, `gc:user:xyz`, `gc:msg:uuid`

### In-Memory Fallback

If Redis is unavailable (e.g., no `REDIS_URL` set), the app automatically falls back to an in-memory store. This means:
- ✅ App still works
- ❌ Data is lost on server restart
- ❌ No persistence across multiple server instances

### Redis Keys Used

| Key Pattern | Purpose | TTL |
|-------------|---------|-----|
| `gc:room:{code}` | Room metadata | 24 hours |
| `gc:room:{code}:users` | User presence hash | 24 hours |
| `gc:room:{code}:requests` | Join requests hash | 1 hour |
| `gc:room:{code}:creator` | Creator user ID | 24 hours |
| `gc:msg:{code}:{id}` | Message metadata | Message TTL |
| `gc:rate:msg:{userId}` | Message rate limit | 60 seconds |
| `gc:rate:conn:{ip}` | Connection rate limit | 60 seconds |

---

## 9. Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3001` | Server port |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection URL |
| `NODE_ENV` | No | `development` | Environment mode |

### Frontend (`frontend/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_API_URL` | No | (empty = same origin) | Backend URL for dev |

### Render (Production)

These are set automatically by `render.yaml`:
- `REDIS_URL` — from the linked Redis service
- `NODE_ENV` — `production`

---

## 10. Running Tests

```bash
# Make sure the server is running first
cd backend
node src/index.js &

# Run original feature tests (34 tests)
node test.js

# Run comprehensive tests (126 tests)
node test-comprehensive.js

# Expected output: 160 total tests, 0 failures
```

### Test Categories

| Category | Test Count |
|----------|-----------|
| Health & Server | 9 |
| Room Creation | 14 |
| Join Request Flow | 13 |
| Messaging | 22 |
| Reply Feature | 10 |
| Message Deletion | 5 |
| Panic Delete | 6 |
| Typing Indicators | 8 |
| Presence & Disconnect | 6 |
| Rate Limiting | 4 |
| Visibility | 6 |
| Delete Permissions | 4 |
| Message Constraints | 4 |
| Creator Rejoin & No Duplicates | 5 |
| Offline Message Recovery | 6 |
| Room Code Trimming | 4 |
| Rejoin Active State | 2 |
| Creator Identity & Absence | 5 |
| Edge Cases & Stability | 9 |
| Multiple Users & Concurrency | 8 |
| Clean Exit | 3 |

---

## 11. Troubleshooting

### Server won't start

```bash
# Check if port 3001 is already in use
lsof -i :3001
# Kill existing process
kill $(lsof -t -i:3001)
```

### Redis connection error

```bash
# Check if Redis is running
redis-cli ping
# Should return: PONG

# If using Docker
docker ps | grep redis
# If not running:
docker start redis
```

### Frontend can't connect to backend

- In dev mode, Vite proxies `/socket.io` to `localhost:3001`
- Check `frontend/vite.config.js` has the proxy configured
- Make sure backend is running on port 3001

### WebSocket errors in browser console

- Check that the backend URL is correct
- In production, frontend and backend must be on the same origin
- Check CORS settings in `backend/src/index.js`

### Tests failing with timeout

- Restart the server (rate limit counters may be exhausted)
- Make sure no other test suite is running simultaneously
- Check Redis connection

### Render deployment fails

- Check build logs in Render dashboard
- Make sure `package.json` has correct scripts
- Verify `render.yaml` syntax
- Check that the Dockerfile builds locally: `docker build -t ghost-chat .`

---

## Quick Reference

| What | URL |
|------|-----|
| Live app | https://badri.online |
| Render dashboard | https://dashboard.render.com |
| GitHub repo | https://github.com/Badri-2915/ghost-chat |
| Health check | https://badri.online/api/health |
| Sitemap | https://badri.online/sitemap.xml |
| Robots.txt | https://badri.online/robots.txt |
| Google Search Console | https://search.google.com/search-console |
| UptimeRobot | https://uptimerobot.com |
| GoDaddy DNS | https://dcc.godaddy.com |
