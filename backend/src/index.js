// =============================================================================
// index.js — Ghost Chat server entry point.
// Sets up Express for HTTP, Socket.IO for real-time WebSocket communication,
// and connects to Redis (shared with 2goi) for ephemeral storage.
// In production, also serves the Vite-built React frontend as static files.
// =============================================================================

// Load environment variables from .env file (REDIS_URL, PORT, CORS_ORIGINS, etc.)
require('dotenv').config();

// Express is the HTTP server framework — handles REST endpoints and static file serving
const express = require('express');

// Node's built-in HTTP module — needed to wrap Express so Socket.IO can share the same port
const http = require('http');

// Socket.IO Server class — manages WebSocket connections with named events and rooms
const { Server } = require('socket.io');

// path is used to construct OS-safe file paths for static file serving
const path = require('path');

// cors middleware allows cross-origin requests from the frontend dev server (localhost:5173)
const cors = require('cors');

// initRedis connects to Redis at startup and sets the storage backend (Redis or in-memory)
const { initRedis } = require('./redis');

// rateLimitConnection enforces per-IP connection limits to prevent DoS attacks
const { rateLimitConnection } = require('./rateLimiter');

// Room lifecycle handlers: create, join, approve, reject, rejoin, leave, disconnect, presence
const {
  handleCreateRoom,    // Client emits 'create-room' to create a new chat room
  handleJoinRequest,   // Client emits 'join-request' to request entry into a room
  handleApproveJoin,   // Creator emits 'approve-join' to accept a pending user
  handleRejectJoin,    // Creator emits 'reject-join' to deny a pending user
  handleRejoinRoom,    // Client emits 'rejoin-room' after socket reconnect
  handleLeaveRoom,     // Client emits 'leave-room' to intentionally exit
  handleDisconnect,    // Fired by Socket.IO 'disconnect' event (network drop, tab close)
  handleUserInactive,  // Client emits 'user_inactive' when tab is hidden
  handleUserActive,    // Client emits 'user_active' when tab becomes visible
} = require('./socket/rooms');

// Message and interaction handlers: send, receipts, typing, delete, panic, visibility
const {
  handleSendMessage,       // Client emits 'send-message' with encrypted payload
  handleMessageDelivered,  // Client emits 'message-delivered' as delivery receipt
  handleMessageRead,       // Client emits 'message-read' as read receipt
  handleTypingStart,       // Client emits 'typing-start' when user begins typing
  handleTypingStop,        // Client emits 'typing-stop' when user pauses/sends
  handleDeleteMessage,     // Client emits 'delete-message' to remove a single message
  handlePanicDelete,       // Client emits 'panic-delete' to wipe all messages
  handleVisibilityChange,  // Client emits 'visibility-change' for screenshot awareness
} = require('./socket/handlers');

// Create the Express application instance
const app = express();

// Wrap Express in a native HTTP server — Socket.IO attaches to this same server
// so WebSocket and HTTP share the same port (no CORS port-mismatch issues)
const server = http.createServer(app);

// Parse CORS_ORIGINS env var (comma-separated URLs) or default to localhost dev server
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim())
  : ['http://localhost:5173'];

// Apply CORS middleware — allows the frontend dev server to make requests to this backend
app.use(cors({ origin: corsOrigins }));

// Parse JSON request bodies — needed for /api/leave POST handler
app.use(express.json());

// Counter tracking currently connected Socket.IO sockets — reported in health check
let activeConnections = 0;

// Health check endpoint — pinged by UptimeRobot every 5 min to prevent Render cold starts
// Returns: { status, connections, uptime } — connections and uptime help monitor load
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',                   // Always 'ok' if server is alive
    connections: activeConnections,  // Active WebSocket connection count
    uptime: process.uptime(),        // Seconds the Node.js process has been running
  });
});

// Absolute path to backend/static — where the Vite-built React frontend files are copied
const staticPath = path.join(__dirname, '..', 'static');

// Serve built frontend assets (JS, CSS, images) — only active in production
// In development, the Vite dev server serves the frontend separately
app.use(express.static(staticPath));

// Instant-leave endpoint — the frontend calls this via navigator.sendBeacon() on tab close.
// sendBeacon fires reliably even as the page unloads (unlike fetch/XHR which may be cancelled).
// Without this, the server would only know about disconnects after the pingTimeout (20 seconds).
// This handler forces the socket to disconnect immediately, triggering the disconnect flow.
app.post('/api/leave', (req, res) => {
  const { roomCode, userId } = req.body || {};

  // Require both fields to prevent malformed requests
  if (!roomCode || !userId) return res.status(400).end();

  // Import socketUsers here (not at top) to avoid circular dependency issues at startup
  const { socketUsers } = require('./socket/rooms');

  // Scan the in-memory socket map for a matching userId + roomCode combination
  for (const [socketId, data] of socketUsers.entries()) {
    if (data.userId === userId && data.roomId === roomCode) {
      const s = io.sockets.sockets.get(socketId); // Get the actual Socket.IO socket object
      if (s) s.disconnect(true);  // Force-close the socket — triggers 'disconnect' event
      break; // Only disconnect once (user should only have one active socket)
    }
  }

  res.status(200).end(); // Acknowledge the beacon (body is ignored by browser anyway)
});

// Create the Socket.IO server, sharing the HTTP server and CORS config.
// pingTimeout: how long (ms) to wait for a pong before declaring the client disconnected.
// pingInterval: how often (ms) to send a ping heartbeat to connected clients.
// These values (20s timeout, 10s interval) balance between fast disconnect detection
// and resilience to brief network blips (especially on mobile).
const io = new Server(server, {
  cors: {
    origin: corsOrigins,     // Allow same origins as Express CORS
    methods: ['GET', 'POST'], // Required by Socket.IO handshake
  },
  pingTimeout: 20000,   // 20s — declare disconnected if no pong received within this time
  pingInterval: 10000,  // 10s — send a ping every 10 seconds to keep connection alive
});

// Main Socket.IO connection handler — fires for every new WebSocket connection
io.on('connection', async (socket) => {
  // Extract client IP — check x-forwarded-for first (set by Render/proxies), fallback to direct IP
  const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

  // Enforce per-IP connection rate limit before accepting the socket
  // 200 connections/min per IP prevents DoS via socket flooding
  const allowed = await rateLimitConnection(ip);
  if (!allowed) {
    socket.emit('error-message', { message: 'Too many connections. Try again later.' });
    socket.disconnect(true); // Forcefully close the over-limit socket
    return;
  }

  // Track connection count for health reporting
  activeConnections++;
  console.log(`[Socket] Connected: ${socket.id} (${activeConnections} total)`);

  // ---- Room lifecycle events ----
  socket.on('create-room', (data) => handleCreateRoom(socket, io, data));     // Create new room
  socket.on('join-request', (data) => handleJoinRequest(socket, io, data));   // Request to join
  socket.on('approve-join', (data) => handleApproveJoin(socket, io, data));   // Creator approves
  socket.on('reject-join', (data) => handleRejectJoin(socket, io, data));     // Creator rejects
  socket.on('rejoin-room', (data) => handleRejoinRoom(socket, io, data));     // Auto-reconnect
  socket.on('leave-room', () => handleLeaveRoom(socket, io));                 // Intentional exit

  // ---- Message events ----
  socket.on('send-message', (data) => handleSendMessage(socket, io, data));           // Send encrypted msg
  socket.on('message-delivered', (data) => handleMessageDelivered(socket, io, data)); // Delivery receipt
  socket.on('message-read', (data) => handleMessageRead(socket, io, data));           // Read receipt
  socket.on('delete-message', (data) => handleDeleteMessage(socket, io, data));       // Single delete
  socket.on('panic-delete', (data) => handlePanicDelete(socket, io, data));           // Wipe all messages

  // ---- Typing indicator events ----
  socket.on('typing-start', (data) => handleTypingStart(socket, io, data)); // User started typing
  socket.on('typing-stop', (data) => handleTypingStop(socket, io, data));   // User stopped typing

  // ---- Tab visibility awareness ----
  // Emitted when the user's tab becomes hidden/visible (screenshot deterrence + presence)
  socket.on('visibility-change', (data) => handleVisibilityChange(socket, io, data));

  // ---- 3-state presence (active / inactive / offline) ----
  // user_inactive: tab switched away (document.hidden = true)
  // user_active: tab returned (document.hidden = false)
  socket.on('user_inactive', () => handleUserInactive(socket, io));
  socket.on('user_active', () => handleUserActive(socket, io));

  // ---- Socket disconnect — fired by Socket.IO on any connection loss ----
  socket.on('disconnect', async () => {
    activeConnections--; // Decrement connection counter
    console.log(`[Socket] Disconnected: ${socket.id} (${activeConnections} total)`);
    await handleDisconnect(socket, io); // Run room cleanup and offline presence logic
  });
});

// SPA fallback: for any route that isn't /api/* or a static asset,
// serve index.html so React Router can handle client-side navigation.
// This enables the deep link feature: /r/ROOMCODE opens the join form.
app.get('*', (req, res) => {
  const indexPath = path.join(staticPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(404).json({ error: 'Not found' }); // Only if index.html is truly missing
    }
  });
});

// Server port — defaults to 3001 for local dev, overridden by Render's PORT env var
const PORT = process.env.PORT || 3001;

// Async startup: connect to Redis first, then start listening for connections.
// If Redis fails, the app continues with the in-memory fallback (logged as a warning).
async function start() {
  try {
    await initRedis(); // Attempt Redis connection (or set useMemory = true on failure)
    console.log('[Redis] Initialized');
  } catch (err) {
    console.warn('[Redis] Failed to connect, running without Redis:', err.message);
  }

  server.listen(PORT, () => {
    console.log(`[Server] Ghost Chat running on port ${PORT}`);
  });
}

// Kick off the startup sequence
start();
