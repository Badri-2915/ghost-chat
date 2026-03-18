const { v4: uuidv4 } = require('uuid');
const { storeMessage, deleteMessage, refreshRoomTTL } = require('../redis');
const { rateLimitMessage } = require('../rateLimiter');
const { getSocketUser } = require('./rooms');

async function handleSendMessage(socket, io, { roomCode, encryptedContent, ttl }) {
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

  // TTL mapping (seconds)
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
  };

  // Send to all users in the room
  io.to(roomCode).emit('new-message', messageData);
}

function handleMessageDelivered(socket, io, { roomCode, messageId }) {
  const userData = getSocketUser(socket.id);
  if (!userData || userData.roomId !== roomCode) return;

  // Notify sender that message was delivered
  socket.to(roomCode).emit('message-status-update', {
    messageId,
    status: 'delivered',
    userId: userData.userId,
  });
}

function handleMessageRead(socket, io, { roomCode, messageId }) {
  const userData = getSocketUser(socket.id);
  if (!userData || userData.roomId !== roomCode) return;

  // Notify sender that message was read
  socket.to(roomCode).emit('message-status-update', {
    messageId,
    status: 'read',
    userId: userData.userId,
  });
}

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

async function handleDeleteMessage(socket, io, { roomCode, messageId }) {
  const userData = getSocketUser(socket.id);
  if (!userData || userData.roomId !== roomCode) return;

  await deleteMessage(roomCode, messageId);

  io.to(roomCode).emit('message-deleted', { messageId });
}

module.exports = {
  handleSendMessage,
  handleMessageDelivered,
  handleMessageRead,
  handleTypingStart,
  handleTypingStop,
  handleDeleteMessage,
};
