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
  removeUserByUsername,
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
  const trimmedCode = (roomCode || '').trim();
  const room = await getRoom(trimmedCode);

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

    // Remove any stale entries for this username before adding fresh
    await removeUserByUsername(trimmedCode, username);
    // Also clean up any stale socketUsers entries for this username+room
    cleanStaleSocketEntries(trimmedCode, username);

    socket.join(trimmedCode);
    socketUsers.set(socket.id, { roomId: trimmedCode, userId, username });
    await addUserToRoom(trimmedCode, userId, username);
    await updateRoomCreator(trimmedCode, userId);
    await refreshRoomTTL(trimmedCode);

    socket.emit('join-approved', { roomCode: trimmedCode, userId, username, isCreator: true, creatorId: userId });

    const users = await getRoomUsers(trimmedCode);
    io.to(trimmedCode).emit('users-updated', { users, creator: userId });
    io.to(trimmedCode).emit('user-rejoined', { userId, username });

    // Broadcast active state so UI doesn't show as inactive after rejoin
    io.to(trimmedCode).emit('user-state-changed', { userId, username, state: 'active' });

    // Deliver missed messages (buffered under old creator userId)
    try {
      const missed = await getMissedMessages(trimmedCode, oldCreatorId);
      for (const msg of missed) socket.emit('new-message', msg);
    } catch (e) { /* best effort */ }
    return;
  }

  const userId = generateUserId();

  // Remove any stale entries for this username before adding pending
  await removeUserByUsername(trimmedCode, username);
  cleanStaleSocketEntries(trimmedCode, username);

  socketUsers.set(socket.id, { roomId: trimmedCode, userId, username, pending: true });

  await addJoinRequest(trimmedCode, userId, username);

  socket.emit('join-requested', { roomCode: trimmedCode, userId, username });

  // Notify creator
  const creatorSocketId = findSocketByUserId(io, room.creator, trimmedCode);
  if (creatorSocketId) {
    const requests = await getJoinRequests(trimmedCode);
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
  const trimmedCode = (roomCode || '').trim();
  const room = await getRoom(trimmedCode);
  if (!room) {
    socket.emit('error-message', { message: 'Room no longer exists' });
    return;
  }

  // Clean stale entries for this username (prevents duplicates)
  await removeUserByUsername(trimmedCode, username);
  cleanStaleSocketEntries(trimmedCode, username);

  // Cancel any pending disconnect removal for this user
  cancelPendingRemoval(userId);

  // Register the new socket with the existing userId
  socket.join(trimmedCode);
  socketUsers.set(socket.id, { roomId: trimmedCode, userId, username });

  await addUserToRoom(trimmedCode, userId, username);
  await refreshRoomTTL(trimmedCode);

  const users = await getRoomUsers(trimmedCode);
  io.to(trimmedCode).emit('users-updated', { users, creator: room.creator });
  io.to(trimmedCode).emit('user-rejoined', { userId, username });

  // Broadcast active state so UI doesn't show as inactive after rejoin
  io.to(trimmedCode).emit('user-state-changed', { userId, username, state: 'active' });

  // Deliver missed messages for this user
  try {
    const missed = await getMissedMessages(trimmedCode, userId);
    for (const msg of missed) socket.emit('new-message', msg);
  } catch (e) { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Disconnect cleanup: remove user from room, notify remaining members
// ---------------------------------------------------------------------------
// Pending removal timers — allows grace period for offline buffering
const pendingRemovals = new Map();

function cancelPendingRemoval(userId) {
  const timer = pendingRemovals.get(userId);
  if (timer) {
    clearTimeout(timer);
    pendingRemovals.delete(userId);
  }
}

async function handleDisconnect(socket, io) {
  const userData = socketUsers.get(socket.id);
  if (!userData) return;

  const { roomId, userId, username } = userData;
  socketUsers.delete(socket.id);

  if (userData.pending) return;

  // Check if this user still has another active socket (e.g. reconnect already happened)
  const otherSocket = findSocketByUserId(io, userId, roomId);
  if (otherSocket) return; // Still connected via another socket — skip cleanup

  // Emit user-left immediately for UI
  io.to(roomId).emit('user-left', { userId, username });

  // Delay Redis removal by 10s to allow offline message buffering.
  // If the user rejoins within 10s, the timer is cancelled.
  const timer = setTimeout(async () => {
    pendingRemovals.delete(userId);
    await removeUserFromRoom(roomId, userId);
    const users = await getRoomUsers(roomId);
    const roomData = await getRoom(roomId);
    if (roomData) {
      io.to(roomId).emit('users-updated', { users, creator: roomData.creator });
    }
  }, 10000);

  pendingRemovals.set(userId, timer);
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

// Utility: remove stale socketUsers entries for a given username + room
function cleanStaleSocketEntries(roomCode, username) {
  for (const [socketId, data] of socketUsers.entries()) {
    if (data.roomId === roomCode && data.username === username) {
      socketUsers.delete(socketId);
    }
  }
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
