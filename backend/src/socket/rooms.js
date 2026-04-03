// =============================================================================
// socket/rooms.js — Room lifecycle management for Ghost Chat.
// Handles room creation, join requests (creator-approved), approval/rejection,
// user disconnect cleanup, and presence tracking.
//
// Identity model:
//   - userId (nanoid, 12 chars) = unique per session, assigned by server
//   - creatorToken (nanoid, 16 chars) = secret token given ONLY to the creator
//   - username = display name only, NOT used for identity or authorization
//   - Creator rejoin: verified by creatorToken, NOT by username match
//   - Same username as creator: treated as different user, needs approval
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
  destroyRoom,
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
  const creatorToken = nanoid(16); // Secret token — only creator knows this

  await createRoom(roomCode, userId, username, creatorToken);
  await addUserToRoom(roomCode, userId, username);

  socket.join(roomCode);
  socketUsers.set(socket.id, { roomId: roomCode, userId, username });

  // Send creatorToken ONLY to the creator (never broadcast to room)
  socket.emit('room-created', {
    roomCode,
    userId,
    username,
    isCreator: true,
    creatorToken, // Client stores this for rejoin verification
  });

  const users = await getRoomUsers(roomCode);
  io.to(roomCode).emit('users-updated', { users, creator: userId });
}

// ---------------------------------------------------------------------------
// Join request: user asks to join, creator must approve. User is "pending".
// ---------------------------------------------------------------------------
async function handleJoinRequest(socket, io, { roomCode, username, creatorToken }) {
  const trimmedCode = (roomCode || '').trim();
  const room = await getRoom(trimmedCode);

  if (!room) {
    socket.emit('error-message', { message: 'Room not found' });
    return;
  }

  // ---- Creator rejoin: verified by creatorToken (NOT username) ----
  // The creatorToken is a secret only the original creator possesses.
  // Username alone is NEVER sufficient for auto-approve.
  const isCreatorRejoin = creatorToken && room.creatorToken && creatorToken === room.creatorToken;

  if (isCreatorRejoin) {
    const userId = generateUserId();
    const oldCreatorId = room.creator;

    // Cancel any pending disconnect removal for the old creator
    cancelPendingRemoval(oldCreatorId);

    // Remove stale entries: old creator userId + username duplicates
    await removeUserFromRoom(trimmedCode, oldCreatorId);
    await removeUserByUsername(trimmedCode, username);
    cleanStaleSocketEntries(trimmedCode, username);
    cleanStaleSocketEntriesById(trimmedCode, oldCreatorId);

    socket.join(trimmedCode);
    socketUsers.set(socket.id, { roomId: trimmedCode, userId, username });
    await addUserToRoom(trimmedCode, userId, username);
    await updateRoomCreator(trimmedCode, userId); // keep same creatorToken
    await refreshRoomTTL(trimmedCode);

    socket.emit('join-approved', { roomCode: trimmedCode, userId, username, isCreator: true, creatorId: userId, creatorToken });

    const users = await getRoomUsers(trimmedCode);
    // Emit user-rejoined FIRST so frontend clears offlineUserIds before processing users-updated
    io.to(trimmedCode).emit('user-rejoined', { userId, username });
    io.to(trimmedCode).emit('users-updated', { users, creator: userId });

    return;
  }

  // ---- Normal user join: requires creator approval ----
  // Check if creator is online to approve
  const creatorSocketId = findSocketByUserId(io, room.creator, trimmedCode);
  if (!creatorSocketId) {
    socket.emit('error-message', { message: 'Room creator is not available to approve your request' });
    return;
  }

  const userId = generateUserId();

  // NOTE: Do NOT call removeUserByUsername here — username is display-only.
  // Another user with the same name may already be in the room legitimately.
  // Stale entry cleanup only happens on confirmed-identity rejoin (creatorToken or rejoin-room).

  socketUsers.set(socket.id, { roomId: trimmedCode, userId, username, pending: true });

  await addJoinRequest(trimmedCode, userId, username);

  socket.emit('join-requested', { roomCode: trimmedCode, userId, username });

  // Notify creator
  const requests = await getJoinRequests(trimmedCode);
  io.to(creatorSocketId).emit('join-requests-updated', requests);
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
  // Emit user-joined (first time) BEFORE users-updated so frontend can show correct toast
  io.to(roomCode).emit('user-joined', { userId, username: requestData.username });
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
async function handleRejoinRoom(socket, io, { roomCode, userId, username, creatorToken }) {
  const trimmedCode = (roomCode || '').trim();
  const room = await getRoom(trimmedCode);
  if (!room) {
    socket.emit('error-message', { message: 'Room no longer exists' });
    return;
  }

  // If this user already has an active socket in this room, skip (prevents duplicate rejoin)
  const existingSocketId = findSocketByUserId(io, userId, trimmedCode);
  if (existingSocketId && existingSocketId !== socket.id) {
    const existingSock = io.sockets.sockets.get(existingSocketId);
    if (existingSock && existingSock.connected) {
      // Already connected via another socket — update username if changed, sync state
      const oldData = socketUsers.get(existingSocketId);
      if (oldData && oldData.username !== username) {
        await removeUserByUsername(trimmedCode, oldData.username);
        cleanStaleSocketEntries(trimmedCode, oldData.username);
        await removeUserFromRoom(trimmedCode, userId);
        await addUserToRoom(trimmedCode, userId, username);
      }
      socket.join(trimmedCode);
      socketUsers.set(socket.id, { roomId: trimmedCode, userId, username });
      const users = await getRoomUsers(trimmedCode);
      const updatedRoom = await getRoom(trimmedCode);
      io.to(trimmedCode).emit('users-updated', { users, creator: updatedRoom?.creator || room.creator });
      return;
    }
    // Stale socket — clean it up
    socketUsers.delete(existingSocketId);
  }

  // Check if this is a creator rejoin via creatorToken
  const isCreatorRejoin = creatorToken && room.creatorToken && creatorToken === room.creatorToken;

  // Cancel any pending disconnect removal for this user
  cancelPendingRemoval(userId);
  // Also cancel pending removal for the old creator userId (may differ)
  if (isCreatorRejoin && room.creator !== userId) {
    cancelPendingRemoval(room.creator);
  }

  // Look up old username for this userId (may differ if user changed name)
  const existingUsers = await getRoomUsers(trimmedCode);
  const oldEntry = existingUsers[userId];
  const oldUsername = oldEntry ? (typeof oldEntry === 'string' ? oldEntry : oldEntry.username) : null;

  // Clean stale entries for this userId AND username (prevents duplicate users in list)
  await removeUserFromRoom(trimmedCode, userId);  // remove old entry by userId
  await removeUserByUsername(trimmedCode, username); // remove any stale entries with new username
  if (oldUsername && oldUsername !== username) {
    await removeUserByUsername(trimmedCode, oldUsername); // remove old username entries too
    cleanStaleSocketEntries(trimmedCode, oldUsername);
  }
  cleanStaleSocketEntries(trimmedCode, username);
  // Also clean stale socket entries by userId (different username, same userId)
  cleanStaleSocketEntriesById(trimmedCode, userId);

  // Register the new socket with the existing userId
  socket.join(trimmedCode);
  socketUsers.set(socket.id, { roomId: trimmedCode, userId, username });

  await addUserToRoom(trimmedCode, userId, username);

  // If creator rejoin, update the creator field to this userId
  if (isCreatorRejoin) {
    await updateRoomCreator(trimmedCode, userId);
  }

  await refreshRoomTTL(trimmedCode);

  const updatedRoom = await getRoom(trimmedCode);
  const users = await getRoomUsers(trimmedCode);
  // Emit user-rejoined FIRST so frontend clears offlineUserIds before processing users-updated
  io.to(trimmedCode).emit('user-rejoined', { userId, username });
  io.to(trimmedCode).emit('users-updated', { users, creator: updatedRoom?.creator || room.creator });

}

// ---------------------------------------------------------------------------
// Explicit leave: user clicked "Leave Room" button
// ---------------------------------------------------------------------------
async function handleLeaveRoom(socket, io) {
  const userData = socketUsers.get(socket.id);
  if (!userData || userData.pending) return;

  const { roomId, userId, username } = userData;

  // Mark as explicitly left so handleDisconnect skips this socket
  userData.left = true;
  socketUsers.delete(socket.id);
  socket.leave(roomId);

  // Cancel any pending removal timer
  cancelPendingRemoval(userId);

  // Remove from Redis immediately
  await removeUserFromRoom(roomId, userId);

  // Emit explicit leave event ("left the room", not "disconnected")
  io.to(roomId).emit('user-left-room', { userId, username });

  // Check if room is now empty
  const users = await getRoomUsers(roomId);
  if (Object.keys(users).length === 0) {
    await destroyRoom(roomId);
    console.log(`[Room] ${roomId} destroyed - no users remaining`);
  } else {
    const roomData = await getRoom(roomId);
    if (roomData) {
      io.to(roomId).emit('users-updated', { users, creator: roomData.creator });
    }
  }
}

// ---------------------------------------------------------------------------
// Disconnect cleanup: remove user from room, notify remaining members
// ---------------------------------------------------------------------------
// Pending removal timers — allows a short grace period for reconnection before removing user
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

  // Skip if user explicitly left (handleLeaveRoom already handled it)
  if (userData.left) return;
  if (userData.pending) return;

  // Check if this user still has another active socket (e.g. reconnect already happened)
  const otherSocket = findSocketByUserId(io, userId, roomId);
  if (otherSocket) return; // Still connected via another socket — skip cleanup

  // Emit user-left and offline state immediately for UI
  io.to(roomId).emit('user-left', { userId, username });
  io.to(roomId).emit('user-state-changed', { userId, username, state: 'offline' });

  // Delay Redis removal to allow reconnection within the grace window.
  // If the user rejoins before the timer fires, cancelPendingRemoval stops the removal.
  const OFFLINE_GRACE_MS = 5 * 60 * 1000; // 5 minutes
  const timer = setTimeout(async () => {
    pendingRemovals.delete(userId);
    await removeUserFromRoom(roomId, userId);
    
    // Check if room is now empty and destroy it completely
    const users = await getRoomUsers(roomId);
    if (Object.keys(users).length === 0) {
      // Room is empty - destroy all data
      await destroyRoom(roomId);
      console.log(`[Room] ${roomId} destroyed - no users remaining`);
    } else {
      // Room still has users - update the list
      const roomData = await getRoom(roomId);
      if (roomData) {
        io.to(roomId).emit('users-updated', { users, creator: roomData.creator });
      }
    }
  }, OFFLINE_GRACE_MS);

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

// Utility: remove stale socketUsers entries for a given userId + room
function cleanStaleSocketEntriesById(roomCode, userId) {
  for (const [socketId, data] of socketUsers.entries()) {
    if (data.roomId === roomCode && data.userId === userId) {
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
  handleLeaveRoom,
  handleDisconnect,
  handleUserInactive,
  handleUserActive,
  getSocketUser,
  socketUsers,
};
