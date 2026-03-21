// =============================================================================
// index.js — Ghost Chat server entry point.
// Sets up Express for HTTP, Socket.IO for real-time WebSocket communication,
// and connects to Redis (shared with 2goi) for ephemeral storage.
// In production, also serves the Vite-built React frontend as static files.
// =============================================================================

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const { initRedis } = require('./redis');
const { rateLimitConnection } = require('./rateLimiter');
const {
  handleCreateRoom,
  handleJoinRequest,
  handleApproveJoin,
  handleRejectJoin,
  handleRejoinRoom,
  handleLeaveRoom,
  handleDisconnect,
  handleUserInactive,
  handleUserActive,
} = require('./socket/rooms');
const {
  handleSendMessage,
  handleMessageDelivered,
  handleMessageRead,
  handleTypingStart,
  handleTypingStop,
  handleDeleteMessage,
  handlePanicDelete,
  handleVisibilityChange,
} = require('./socket/handlers');

const app = express();
const server = http.createServer(app);

const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim())
  : ['http://localhost:5173'];

app.use(cors({ origin: corsOrigins }));
app.use(express.json());

// Health check endpoint
let activeConnections = 0;

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    connections: activeConnections,
    uptime: process.uptime(),
  });
});

// Serve static frontend files in production
const staticPath = path.join(__dirname, '..', 'static');
app.use(express.static(staticPath));

// Instant leave endpoint — called via sendBeacon on tab/browser close
// This triggers immediate disconnect handling without waiting for pingTimeout
app.post('/api/leave', (req, res) => {
  const { roomCode, userId } = req.body || {};
  if (!roomCode || !userId) return res.status(400).end();
  
  // Find and disconnect the socket for this user
  const { socketUsers } = require('./socket/rooms');
  for (const [socketId, data] of socketUsers.entries()) {
    if (data.userId === userId && data.roomId === roomCode) {
      const s = io.sockets.sockets.get(socketId);
      if (s) s.disconnect(true);
      break;
    }
  }
  res.status(200).end();
});

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: corsOrigins,
    methods: ['GET', 'POST'],
  },
  pingTimeout: 20000,
  pingInterval: 10000,
});

// Socket.IO connection handling
io.on('connection', async (socket) => {
  const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

  // Rate limit connections per IP
  const allowed = await rateLimitConnection(ip);
  if (!allowed) {
    socket.emit('error-message', { message: 'Too many connections. Try again later.' });
    socket.disconnect(true);
    return;
  }

  activeConnections++;
  console.log(`[Socket] Connected: ${socket.id} (${activeConnections} total)`);

  // Room events
  socket.on('create-room', (data) => handleCreateRoom(socket, io, data));
  socket.on('join-request', (data) => handleJoinRequest(socket, io, data));
  socket.on('approve-join', (data) => handleApproveJoin(socket, io, data));
  socket.on('reject-join', (data) => handleRejectJoin(socket, io, data));
  socket.on('rejoin-room', (data) => handleRejoinRoom(socket, io, data));
  socket.on('leave-room', () => handleLeaveRoom(socket, io));

  // Message events
  socket.on('send-message', (data) => handleSendMessage(socket, io, data));
  socket.on('message-delivered', (data) => handleMessageDelivered(socket, io, data));
  socket.on('message-read', (data) => handleMessageRead(socket, io, data));
  socket.on('delete-message', (data) => handleDeleteMessage(socket, io, data));
  socket.on('panic-delete', (data) => handlePanicDelete(socket, io, data));

  // Typing events
  socket.on('typing-start', (data) => handleTypingStart(socket, io, data));
  socket.on('typing-stop', (data) => handleTypingStop(socket, io, data));

  // Awareness events (tab visibility)
  socket.on('visibility-change', (data) => handleVisibilityChange(socket, io, data));

  // User activity state (3-state: active / inactive / offline)
  socket.on('user_inactive', () => handleUserInactive(socket, io));
  socket.on('user_active', () => handleUserActive(socket, io));

  // Disconnect
  socket.on('disconnect', async () => {
    activeConnections--;
    console.log(`[Socket] Disconnected: ${socket.id} (${activeConnections} total)`);
    await handleDisconnect(socket, io);
  });
});

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  const indexPath = path.join(staticPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(404).json({ error: 'Not found' });
    }
  });
});

// Start server
const PORT = process.env.PORT || 3001;

async function start() {
  try {
    await initRedis();
    console.log('[Redis] Initialized');
  } catch (err) {
    console.warn('[Redis] Failed to connect, running without Redis:', err.message);
  }

  server.listen(PORT, () => {
    console.log(`[Server] Ghost Chat running on port ${PORT}`);
  });
}

start();
