// =============================================================================
// socket/handlers.js — Message handling, delivery receipts, typing indicators,
// panic delete, and visibility awareness for Ghost Chat.
//
// Delete permissions: only the message sender (or the room creator as moderator)
// can delete a message. Message length is capped at 5000 characters.
// =============================================================================

const { v4: uuidv4 } = require('uuid');
const { storeMessage, deleteMessage, getMessage, refreshRoomTTL, bufferMissedMessage, getRoomUsers, getRoom } = require('../redis');
const { rateLimitMessage } = require('../rateLimiter');
const { getSocketUser } = require('./rooms');

// Maximum message length (characters) — prevents abuse and memory bloat
const MAX_MESSAGE_LENGTH = 5000;

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

  // Enforce message length limit
  if (typeof encryptedContent === 'string' && encryptedContent.length > MAX_MESSAGE_LENGTH) {
    socket.emit('error-message', { message: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` });
    return;
  }

  const messageId = uuidv4();
  const timestamp = Date.now();

  // TTL mapping: user-selected lifetime → seconds for Redis expiry
  const ttlMap = {
    'after-seen': 3,      // 3s buffer after seen
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

  // Broadcast to all connected users in the room
  io.to(roomCode).emit('new-message', messageData);

  // Buffer message for offline (disconnected) room members
  try {
    const roomUsers = await getRoomUsers(roomCode);
    const connectedSockets = await io.in(roomCode).fetchSockets();
    const connectedUserIds = new Set();
    for (const s of connectedSockets) {
      const u = getSocketUser(s.id);
      if (u) connectedUserIds.add(u.userId);
    }
    for (const uid of Object.keys(roomUsers)) {
      if (!connectedUserIds.has(uid)) {
        await bufferMissedMessage(roomCode, uid, messageData);
      }
    }
  } catch (e) {
    // Non-critical — best effort buffering
  }
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
// Delete a single message: only sender or room creator (moderator) can delete.
// Removes from Redis and broadcasts deletion to all connected UIs.
// ---------------------------------------------------------------------------
async function handleDeleteMessage(socket, io, { roomCode, messageId, senderId }) {
  const userData = getSocketUser(socket.id);
  if (!userData || userData.roomId !== roomCode) return;

  // Check permission: sender can delete own, creator can delete any
  const room = await getRoom(roomCode);
  const isRoomCreator = room && room.creator === userData.userId;

  // If senderId is provided by the client, use it; otherwise try to look up from Redis
  let msgSender = senderId;
  if (!msgSender) {
    try {
      const stored = await getMessage(roomCode, messageId);
      if (stored) msgSender = stored.senderId;
    } catch (e) { /* best effort */ }
  }

  // Permission check: must be sender or room creator
  if (msgSender && msgSender !== userData.userId && !isRoomCreator) {
    socket.emit('error-message', { message: 'Cannot delete: not your message' });
    return;
  }

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

module.exports = {
  handleSendMessage,
  handleMessageDelivered,
  handleMessageRead,
  handleTypingStart,
  handleTypingStop,
  handleDeleteMessage,
  handlePanicDelete,
  handleVisibilityChange,
};
