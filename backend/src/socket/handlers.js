// =============================================================================
// socket/handlers.js — Message handling, delivery receipts, typing indicators,
// panic delete, and user awareness events (visibility, screenshot detection).
// =============================================================================

const { v4: uuidv4 } = require('uuid');
const { storeMessage, deleteMessage, refreshRoomTTL } = require('../redis');
const { rateLimitMessage } = require('../rateLimiter');
const { getSocketUser } = require('./rooms');

// ---------------------------------------------------------------------------
// Send a new message to the room. Supports optional replyTo for threading.
// ---------------------------------------------------------------------------
async function handleSendMessage(socket, io, { roomCode, encryptedContent, ttl, replyTo }) {
  const userData = getSocketUser(socket.id);
  if (!userData || userData.roomId !== roomCode || userData.pending) {
    socket.emit('error-message', { message: 'Not in room' });
    return;
  }

  // Rate limit check
  const allowed = await rateLimitMessage(userData.userId);
  if (!allowed) {
    socket.emit('error-message', { message: 'Rate limit exceeded. Slow down.' });
    return;
  }

  const messageId = uuidv4();
  const timestamp = Date.now();

  // TTL mapping: user-selected lifetime → seconds for Redis expiry
  const ttlMap = {
    'after-seen': 10,     // 10s buffer after seen
    '5s': 5,
    '15s': 15,
    '30s': 30,
    '1m': 60,
    '5m': 300,
  };

  const ttlSeconds = ttlMap[ttl] || 300; // default 5 min max

  // Store in Redis with TTL
  await storeMessage(roomCode, messageId, {
    senderId: userData.userId,
    senderName: userData.username,
    encryptedContent,
    ttl,
    timestamp,
    replyTo: replyTo || null,
  }, ttlSeconds);

  await refreshRoomTTL(roomCode);

  const messageData = {
    messageId,
    senderId: userData.userId,
    senderName: userData.username,
    encryptedContent,
    ttl,
    ttlSeconds,
    timestamp,
    status: 'sent',
    replyTo: replyTo || null,
  };

  // Broadcast to all users in the room
  io.to(roomCode).emit('new-message', messageData);
}

// ---------------------------------------------------------------------------
// Delivery receipt: receiver acknowledges message was delivered to their device
// ---------------------------------------------------------------------------
function handleMessageDelivered(socket, io, { roomCode, messageId }) {
  const userData = getSocketUser(socket.id);
  if (!userData || userData.roomId !== roomCode) return;

  socket.to(roomCode).emit('message-status-update', {
    messageId,
    status: 'delivered',
    userId: userData.userId,
  });
}

// ---------------------------------------------------------------------------
// Read receipt: receiver confirms message was visible on screen
// ---------------------------------------------------------------------------
function handleMessageRead(socket, io, { roomCode, messageId }) {
  const userData = getSocketUser(socket.id);
  if (!userData || userData.roomId !== roomCode) return;

  socket.to(roomCode).emit('message-status-update', {
    messageId,
    status: 'read',
    userId: userData.userId,
  });
}

// ---------------------------------------------------------------------------
// Typing start/stop: real-time indicator shown to other room members
// ---------------------------------------------------------------------------
function handleTypingStart(socket, io, { roomCode }) {
  const userData = getSocketUser(socket.id);
  if (!userData || userData.roomId !== roomCode) return;

  socket.to(roomCode).emit('user-typing', {
    userId: userData.userId,
    username: userData.username,
  });
}

function handleTypingStop(socket, io, { roomCode }) {
  const userData = getSocketUser(socket.id);
  if (!userData || userData.roomId !== roomCode) return;

  socket.to(roomCode).emit('user-stopped-typing', {
    userId: userData.userId,
  });
}

// ---------------------------------------------------------------------------
// Delete a single message from Redis and all connected UIs
// ---------------------------------------------------------------------------
async function handleDeleteMessage(socket, io, { roomCode, messageId }) {
  const userData = getSocketUser(socket.id);
  if (!userData || userData.roomId !== roomCode) return;

  await deleteMessage(roomCode, messageId);

  io.to(roomCode).emit('message-deleted', { messageId });
}

// ---------------------------------------------------------------------------
// Panic delete: instantly wipe ALL messages for the entire room.
// Clears both the UI (via event) and any Redis-stored message data.
// ---------------------------------------------------------------------------
async function handlePanicDelete(socket, io, { roomCode }) {
  const userData = getSocketUser(socket.id);
  if (!userData || userData.roomId !== roomCode) return;

  // Broadcast to all users to clear their message lists
  io.to(roomCode).emit('panic-delete', {
    triggeredBy: userData.username,
  });
}

// ---------------------------------------------------------------------------
// Visibility change: user switched tabs or minimized — inform the room.
// This is best-effort awareness, not prevention.
// ---------------------------------------------------------------------------
function handleVisibilityChange(socket, io, { roomCode, isVisible }) {
  const userData = getSocketUser(socket.id);
  if (!userData || userData.roomId !== roomCode) return;

  socket.to(roomCode).emit('user-visibility-changed', {
    userId: userData.userId,
    username: userData.username,
    isVisible,
  });
}

// ---------------------------------------------------------------------------
// Screenshot awareness: best-effort detection (tab blur / minimize).
// Notifies the room so they know the user may have captured screen content.
// ---------------------------------------------------------------------------
function handleScreenshotWarning(socket, io, { roomCode }) {
  const userData = getSocketUser(socket.id);
  if (!userData || userData.roomId !== roomCode) return;

  socket.to(roomCode).emit('screenshot-warning', {
    userId: userData.userId,
    username: userData.username,
    timestamp: Date.now(),
  });
}

module.exports = {
  handleSendMessage,
  handleMessageDelivered,
  handleMessageRead,
  handleTypingStart,
  handleTypingStop,
  handleDeleteMessage,
  handlePanicDelete,
  handleVisibilityChange,
  handleScreenshotWarning,
};
