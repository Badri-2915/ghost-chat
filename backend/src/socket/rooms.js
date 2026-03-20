// =============================================================================
// socket/rooms.js — Room lifecycle management for Ghost Chat.
// Handles room creation, join requests (creator-approved), approval/rejection,
// user disconnect cleanup, and presence tracking.
//
// socketUsers Map tracks the mapping from Socket.IO socket IDs to user data,
// enabling us to look up which room and identity a socket belongs to.
// =============================================================================

const { nanoid } = require('nanoid');
const {
  createRoom,
  getRoom,
  updateRoomCreator,
  addUserToRoom,
  removeUserFromRoom,
  getRoomUsers,
  addJoinRequest,
  removeJoinRequest,
  getJoinRequests,
  refreshRoomTTL,
  getMissedMessages,
} = require('../redis');

// In-memory map: socketId -> { roomId, userId, username, pending }
// "pending" is true while a user is waiting for join approval.
const socketUsers = new Map();

// Generate an 8-character alphanumeric room code (e.g. "AhAeFQVR")
function generateRoomCode() {
  return nanoid(8);
}

// Generate a 12-character user ID (unique per session, not persisted)
function generateUserId() {
  return nanoid(12);
}

// ---------------------------------------------------------------------------
// Create a new room: generates code, adds creator, joins Socket.IO room
// ---------------------------------------------------------------------------
async function handleCreateRoom(socket, io, { username }) {
  const roomCode = generateRoomCode();
  const userId = generateUserId();

  await createRoom(roomCode, userId, username);
  await addUserToRoom(roomCode, userId, username);

  socket.join(roomCode);
  socketUsers.set(socket.id, { roomId: roomCode, userId, username });

  socket.emit('room-created', {
    roomCode,
    userId,
    username,
    isCreator: true,
  });

  const users = await getRoomUsers(roomCode);
  io.to(roomCode).emit('users-updated', { users, creator: userId });
}

// ---------------------------------------------------------------------------
// Join request: user asks to join, creator must approve. User is "pending".
// ---------------------------------------------------------------------------
async function handleJoinRequest(socket, io, { roomCode, username }) {
  const room = await getRoom(roomCode);

  if (!room) {
    socket.emit('error-message', { message: 'Room not found' });
    return;
  }

  // Check if this is the room creator rejoining (match by creatorName)
  const isCreatorRejoin = room.creatorName === username;

  if (isCreatorRejoin) {
    // Auto-approve creator — no waiting
    const userId = generateUserId();
    const oldCreatorId = room.creator;
    socket.join(roomCode);
    socketUsers.set(socket.id, { roomId: roomCode, userId, username });
    await addUserToRoom(roomCode, userId, username);
    await updateRoomCreator(roomCode, userId);
    await refreshRoomTTL(roomCode);

    socket.emit('join-approved', { roomCode, userId, username, isCreator: true, creatorId: userId });

    const users = await getRoomUsers(roomCode);
    io.to(roomCode).emit('users-updated', { users, creator: userId });
    io.to(roomCode).emit('user-rejoined', { userId, username });

    // Deliver missed messages (buffered under old creator userId)
    try {
      const missed = await getMissedMessages(roomCode, oldCreatorId);
      for (const msg of missed) socket.emit('new-message', msg);
    } catch (e) { /* best effort */ }
    return;
  }

  const userId = generateUserId();
  socketUsers.set(socket.id, { roomId: roomCode, userId, username, pending: true });

  await addJoinRequest(roomCode, userId, username);

  socket.emit('join-requested', { roomCode, userId, username });

  // Notify creator
  const creatorSocketId = findSocketByUserId(io, room.creator, roomCode);
  if (creatorSocketId) {
    const requests = await getJoinRequests(roomCode);
    io.to(creatorSocketId).emit('join-requests-updated', requests);
  }
}

// ---------------------------------------------------------------------------
// Approve join: creator accepts a pending user into the room
// ---------------------------------------------------------------------------
async function handleApproveJoin(socket, io, { roomCode, userId }) {
  const room = await getRoom(roomCode);
  const userData = socketUsers.get(socket.id);

  if (!room || !userData || room.creator !== userData.userId) {
    socket.emit('error-message', { message: 'Not authorized' });
    return;
  }

  const requests = await getJoinRequests(roomCode);
  const requestData = requests[userId];
  if (!requestData) {
    socket.emit('error-message', { message: 'Join request not found' });
    return;
  }

  await removeJoinRequest(roomCode, userId);
  await addUserToRoom(roomCode, userId, requestData.username);
  await refreshRoomTTL(roomCode);

  // Find the pending user's socket and update it
  const pendingSocketId = findSocketByUserId(io, userId, roomCode);
  if (pendingSocketId) {
    const pendingSocket = io.sockets.sockets.get(pendingSocketId);
    if (pendingSocket) {
      pendingSocket.join(roomCode);
      const userState = socketUsers.get(pendingSocketId);
      if (userState) userState.pending = false;
      pendingSocket.emit('join-approved', { roomCode, userId, username: requestData.username, creatorId: room.creator });
    }
  }

  const users = await getRoomUsers(roomCode);
  const roomData = await getRoom(roomCode);
  io.to(roomCode).emit('users-updated', { users, creator: roomData?.creator });

  // Send updated pending list to creator
  const updatedRequests = await getJoinRequests(roomCode);
  socket.emit('join-requests-updated', updatedRequests);
}

// ---------------------------------------------------------------------------
// Reject join: creator denies a pending user's request
// ---------------------------------------------------------------------------
async function handleRejectJoin(socket, io, { roomCode, userId }) {
  const room = await getRoom(roomCode);
  const userData = socketUsers.get(socket.id);

  if (!room || !userData || room.creator !== userData.userId) {
    socket.emit('error-message', { message: 'Not authorized' });
    return;
  }

  await removeJoinRequest(roomCode, userId);

  // Notify the rejected user
  const pendingSocketId = findSocketByUserId(io, userId, roomCode);
  if (pendingSocketId) {
    const pendingSocket = io.sockets.sockets.get(pendingSocketId);
    if (pendingSocket) {
      pendingSocket.emit('join-rejected', { roomCode });
    }
    socketUsers.delete(pendingSocketId);
  }

  // Update creator's pending list
  const updatedRequests = await getJoinRequests(roomCode);
  socket.emit('join-requests-updated', updatedRequests);
}

// ---------------------------------------------------------------------------
// Rejoin room: user reconnects after a disconnect (same userId, new socket)
// ---------------------------------------------------------------------------
async function handleRejoinRoom(socket, io, { roomCode, userId, username }) {
  const room = await getRoom(roomCode);
  if (!room) {
    socket.emit('error-message', { message: 'Room no longer exists' });
    return;
  }

  // Register the new socket with the existing userId
  socket.join(roomCode);
  socketUsers.set(socket.id, { roomId: roomCode, userId, username });

  // Re-add user to presence (may already exist if disconnect cleanup was slow)
  await addUserToRoom(roomCode, userId, username);
  await refreshRoomTTL(roomCode);

  const users = await getRoomUsers(roomCode);
  io.to(roomCode).emit('users-updated', { users, creator: room.creator });
  io.to(roomCode).emit('user-rejoined', { userId, username });

  // Deliver missed messages for this user
  try {
    const missed = await getMissedMessages(roomCode, userId);
    for (const msg of missed) socket.emit('new-message', msg);
  } catch (e) { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Disconnect cleanup: remove user from room, notify remaining members
// ---------------------------------------------------------------------------
async function handleDisconnect(socket, io) {
  const userData = socketUsers.get(socket.id);
  if (!userData) return;

  const { roomId, userId, username } = userData;
  socketUsers.delete(socket.id);

  if (userData.pending) return;

  // Do NOT remove from Redis room users — keep for offline message buffering.
  // The user stays in getRoomUsers() so messages sent while they're offline
  // get buffered. On rejoin, addUserToRoom() refreshes their entry.
  // Room TTL (6h) auto-cleans stale users.
  const users = await getRoomUsers(roomId);
  const roomData = await getRoom(roomId);
  io.to(roomId).emit('users-updated', { users, creator: roomData?.creator });
  io.to(roomId).emit('user-left', { userId, username });
}

// Utility: find a socket ID by userId and roomCode (linear scan of socketUsers)
function findSocketByUserId(io, userId, roomCode) {
  for (const [socketId, data] of socketUsers.entries()) {
    if (data.userId === userId && data.roomId === roomCode) {
      return socketId;
    }
  }
  return null;
}

// Utility: get user data for a given socket ID
function getSocketUser(socketId) {
  return socketUsers.get(socketId);
}

// ---------------------------------------------------------------------------
// User activity state: track inactive (tab switched) vs active
// ---------------------------------------------------------------------------
function handleUserInactive(socket, io) {
  const userData = socketUsers.get(socket.id);
  if (!userData || userData.pending) return;
  userData.inactive = true;
  socket.to(userData.roomId).emit('user-state-changed', {
    userId: userData.userId,
    username: userData.username,
    state: 'inactive',
  });
}

function handleUserActive(socket, io) {
  const userData = socketUsers.get(socket.id);
  if (!userData || userData.pending) return;
  userData.inactive = false;
  socket.to(userData.roomId).emit('user-state-changed', {
    userId: userData.userId,
    username: userData.username,
    state: 'active',
  });
}

module.exports = {
  handleCreateRoom,
  handleJoinRequest,
  handleApproveJoin,
  handleRejectJoin,
  handleRejoinRoom,
  handleDisconnect,
  handleUserInactive,
  handleUserActive,
  getSocketUser,
  socketUsers,
};
