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

// nanoid generates URL-safe random strings — used for room codes, user IDs, and creator tokens
const { nanoid } = require('nanoid');

// Import all Redis storage functions needed for room lifecycle management
const {
  createRoom,          // Create room metadata in Redis
  getRoom,             // Fetch room metadata by code
  updateRoomCreator,   // Update creator userId after rejoin
  addUserToRoom,       // Add a user to the room's presence hash
  removeUserFromRoom,  // Remove a user from presence by userId
  removeUserByUsername,// Remove all presence entries matching a display name
  getRoomUsers,        // Get all users currently in a room
  addJoinRequest,      // Record a pending join request
  removeJoinRequest,   // Remove a join request (approve/reject)
  getJoinRequests,     // Get all pending join requests for a room
  refreshRoomTTL,      // Reset 6-hour expiry on room activity
  destroyRoom,         // Wipe all room data when empty
} = require('../redis');

// In-memory map: socketId → { roomId, userId, username, pending, left, inactive }
// This is the source of truth for "which user is on which socket"
// 'pending' = true while waiting for creator approval
// 'left' = true when user explicitly clicked Leave (skips disconnect handler cleanup)
// 'inactive' = true when user has switched away from the tab
const socketUsers = new Map();

// Generate an 8-character URL-safe alphanumeric room code (e.g. "AhAeFQVR")
// 8 chars from nanoid alphabet (64 chars) = 64^8 ≈ 281 trillion combinations
function generateRoomCode() {
  return nanoid(8);
}

// Generate a 12-character user ID — unique per session, never persisted to disk
// Serves as the stable identity within a session even if socket reconnects
function generateUserId() {
  return nanoid(12);
}

// ---------------------------------------------------------------------------
// Create a new room: generates room code, creator token, adds creator to room
// and Socket.IO room group, emits confirmation back to creator only.
// ---------------------------------------------------------------------------
async function handleCreateRoom(socket, io, { username }) {
  // Generate a fresh 8-char room code and assign it as the Socket.IO room name
  const roomCode = generateRoomCode();

  // Assign a session-scoped userId — this identifies the creator across reconnects
  const userId = generateUserId();

  // Generate a 16-char secret creatorToken — proves creator identity on rejoin
  // This is the ONLY mechanism for creator identity verification (not username)
  const creatorToken = nanoid(16);

  // Persist room metadata in Redis: creator userId, display name, token, creation time
  await createRoom(roomCode, userId, username, creatorToken);

  // Add the creator to the room's user presence hash in Redis
  await addUserToRoom(roomCode, userId, username);

  // Join the Socket.IO room group — all io.to(roomCode).emit() calls reach this socket
  socket.join(roomCode);

  // Register this socket in the in-memory map for fast lookups
  socketUsers.set(socket.id, { roomId: roomCode, userId, username });

  // Send room-created ONLY to the creator (not broadcast) — includes the secret creatorToken
  // The client stores this token in localStorage for use in future rejoin requests
  socket.emit('room-created', {
    roomCode,       // The 8-char code to share with others
    userId,         // Creator's session identity
    username,       // Creator's display name
    isCreator: true, // Tells the client to set isCreator state
    creatorToken,   // Secret token — client must store securely
  });

  // Broadcast the initial user list (just the creator) to the room
  const users = await getRoomUsers(roomCode);
  io.to(roomCode).emit('users-updated', { users, creator: userId });
}

// ---------------------------------------------------------------------------
// Join request: user submits their name and room code to request entry.
// Two paths: (1) creator rejoin via token → auto-approved, (2) normal user → pending.
// ---------------------------------------------------------------------------
async function handleJoinRequest(socket, io, { roomCode, username, creatorToken }) {
  // Trim whitespace from room code — tolerates accidental spaces in manual entry
  const trimmedCode = (roomCode || '').trim();

  // Fetch room metadata from Redis to check existence and creator info
  const room = await getRoom(trimmedCode);

  // If room doesn't exist (expired or never created), reject immediately
  if (!room) {
    socket.emit('error-message', { message: 'Room not found' });
    return;
  }

  // ---- Path 1: Creator rejoin via creatorToken ----
  // The creatorToken is a 16-char secret stored in the client's localStorage.
  // Token match = creator identity confirmed. Username alone is NEVER sufficient.
  const isCreatorRejoin = creatorToken && room.creatorToken && creatorToken === room.creatorToken;

  if (isCreatorRejoin) {
    // Generate a fresh userId for this session — old userId is no longer valid
    const userId = generateUserId();

    // Store old creator's userId to cancel their pending removal timer
    const oldCreatorId = room.creator;

    // Cancel the 5-minute removal timer that started when the creator disconnected
    cancelPendingRemoval(oldCreatorId);

    // Remove stale entries from Redis and in-memory map:
    await removeUserFromRoom(trimmedCode, oldCreatorId);  // Remove old userId from presence
    await removeUserByUsername(trimmedCode, username);    // Remove any duplicate by display name
    cleanStaleSocketEntries(trimmedCode, username);       // Clean in-memory map by username
    cleanStaleSocketEntriesById(trimmedCode, oldCreatorId); // Clean in-memory map by old userId

    // Register the creator's new socket in the Socket.IO room group
    socket.join(trimmedCode);

    // Register in the in-memory socketUsers map with the new socket and userId
    socketUsers.set(socket.id, { roomId: trimmedCode, userId, username });

    // Re-add creator to Redis presence with new userId
    await addUserToRoom(trimmedCode, userId, username);

    // Update the room's creator field in Redis to the new userId
    // The creatorToken is kept the same — it's tied to the room, not the session
    await updateRoomCreator(trimmedCode, userId);

    // Reset the room's 6-hour TTL — creator is back, room is active
    await refreshRoomTTL(trimmedCode);

    // Auto-approve the creator — send join-approved with creatorToken back to client
    socket.emit('join-approved', {
      roomCode: trimmedCode,
      userId,
      username,
      isCreator: true,     // Tells the client to set isCreator = true
      creatorId: userId,   // The new creator userId
      creatorToken,        // Echo the token back so client can re-store it
    });

    // Fetch updated user list and broadcast to room
    const users = await getRoomUsers(trimmedCode);
    // user-rejoined MUST come before users-updated so frontend clears offline tracking first
    io.to(trimmedCode).emit('user-rejoined', { userId, username });
    io.to(trimmedCode).emit('users-updated', { users, creator: userId });

    return;
  }

  // ---- Path 2: Normal user join — requires creator online + explicit approval ----

  // Find the creator's current socket — if creator is offline, block the join
  const creatorSocketId = findSocketByUserId(io, room.creator, trimmedCode);
  if (!creatorSocketId) {
    // Creator must be present to approve new members — no unsupervised access
    socket.emit('error-message', { message: 'Room creator is not available to approve your request' });
    return;
  }

  // Assign a new session userId to this pending user
  const userId = generateUserId();

  // NOTE: Do NOT remove by username here — the same display name may legitimately
  // belong to a different user already in the room. Cleanup only happens on
  // confirmed-identity paths (creatorToken or rejoin-room with matching userId).

  // Register this socket as 'pending' — they cannot send messages yet
  socketUsers.set(socket.id, { roomId: trimmedCode, userId, username, pending: true });

  // Store the join request in Redis so it survives brief disconnects
  await addJoinRequest(trimmedCode, userId, username);

  // Acknowledge to the requester — they will show a "Waiting for approval" screen
  socket.emit('join-requested', { roomCode: trimmedCode, userId, username });

  // Send updated pending request list to the creator only
  const requests = await getJoinRequests(trimmedCode);
  io.to(creatorSocketId).emit('join-requests-updated', requests);
}

// ---------------------------------------------------------------------------
// Approve join: room creator accepts a pending user's join request.
// Promotes the user from pending → active, adds to room, notifies everyone.
// ---------------------------------------------------------------------------
async function handleApproveJoin(socket, io, { roomCode, userId }) {
  // Fetch room metadata and approver's data for authorization check
  const room = await getRoom(roomCode);
  const userData = socketUsers.get(socket.id);

  // Only the room creator can approve join requests
  if (!room || !userData || room.creator !== userData.userId) {
    socket.emit('error-message', { message: 'Not authorized' });
    return;
  }

  // Verify the join request still exists (may have timed out or been cancelled)
  const requests = await getJoinRequests(roomCode);
  const requestData = requests[userId];
  if (!requestData) {
    socket.emit('error-message', { message: 'Join request not found' });
    return;
  }

  // Remove from pending list — user is being promoted to active member
  await removeJoinRequest(roomCode, userId);

  // Add to the room's active presence hash in Redis
  await addUserToRoom(roomCode, userId, requestData.username);

  // Refresh room TTL — activity in the room resets the 6-hour expiry
  await refreshRoomTTL(roomCode);

  // Find the approved user's socket and promote them from pending → active
  const pendingSocketId = findSocketByUserId(io, userId, roomCode);
  if (pendingSocketId) {
    const pendingSocket = io.sockets.sockets.get(pendingSocketId);
    if (pendingSocket) {
      // Move the socket into the Socket.IO room group so they receive broadcasts
      pendingSocket.join(roomCode);

      // Clear the pending flag — they can now send messages
      const userState = socketUsers.get(pendingSocketId);
      if (userState) userState.pending = false;

      // Notify the approved user — client transitions from WaitingRoom → ChatRoom
      pendingSocket.emit('join-approved', {
        roomCode,
        userId,
        username: requestData.username,
        creatorId: room.creator,  // Client needs this to know who the creator is
      });
    }
  }

  // Broadcast updated user list to everyone in the room
  const users = await getRoomUsers(roomCode);
  const roomData = await getRoom(roomCode);

  // user-joined fires before users-updated so frontend shows "X joined" toast at the right time
  io.to(roomCode).emit('user-joined', { userId, username: requestData.username });
  io.to(roomCode).emit('users-updated', { users, creator: roomData?.creator });

  // Send the updated (now shorter) pending request list back to the creator
  const updatedRequests = await getJoinRequests(roomCode);
  socket.emit('join-requests-updated', updatedRequests);
}

// ---------------------------------------------------------------------------
// Reject join: creator denies a pending user's request.
// The rejected user is notified, their socket record is cleaned up.
// ---------------------------------------------------------------------------
async function handleRejectJoin(socket, io, { roomCode, userId }) {
  const room = await getRoom(roomCode);
  const userData = socketUsers.get(socket.id);

  // Authorization: only the room creator can reject join requests
  if (!room || !userData || room.creator !== userData.userId) {
    socket.emit('error-message', { message: 'Not authorized' });
    return;
  }

  // Remove the pending request from Redis
  await removeJoinRequest(roomCode, userId);

  // Find and notify the rejected user's socket
  const pendingSocketId = findSocketByUserId(io, userId, roomCode);
  if (pendingSocketId) {
    const pendingSocket = io.sockets.sockets.get(pendingSocketId);
    if (pendingSocket) {
      // Inform the rejected user — client shows an error and returns to landing
      pendingSocket.emit('join-rejected', { roomCode });
    }
    // Remove their socket record from in-memory map — they are no longer tracked
    socketUsers.delete(pendingSocketId);
  }

  // Send the updated (now shorter) pending list back to the creator
  const updatedRequests = await getJoinRequests(roomCode);
  socket.emit('join-requests-updated', updatedRequests);
}

// ---------------------------------------------------------------------------
// Rejoin room: called when the frontend auto-rejoins after a socket disconnect.
// The client sends its stored { roomCode, userId, username, creatorToken }.
// The server re-registers the new socket with the same logical userId.
// ---------------------------------------------------------------------------
async function handleRejoinRoom(socket, io, { roomCode, userId, username, creatorToken }) {
  // Trim whitespace — room codes may have been copied with trailing spaces
  const trimmedCode = (roomCode || '').trim();

  // Verify the room still exists — it may have been destroyed if everyone left
  const room = await getRoom(trimmedCode);
  if (!room) {
    socket.emit('error-message', { message: 'Room no longer exists' });
    return;
  }

  // Check if this userId already has an active socket (e.g. fired twice, or tab duplicated)
  const existingSocketId = findSocketByUserId(io, userId, trimmedCode);
  if (existingSocketId && existingSocketId !== socket.id) {
    const existingSock = io.sockets.sockets.get(existingSocketId);
    if (existingSock && existingSock.connected) {
      // User is already connected on another socket — just sync the new socket in
      const oldData = socketUsers.get(existingSocketId);
      if (oldData && oldData.username !== username) {
        // Username changed — update the presence entry
        await removeUserByUsername(trimmedCode, oldData.username);
        cleanStaleSocketEntries(trimmedCode, oldData.username);
        await removeUserFromRoom(trimmedCode, userId);
        await addUserToRoom(trimmedCode, userId, username);
      }
      // Register the new socket alongside the existing one
      socket.join(trimmedCode);
      socketUsers.set(socket.id, { roomId: trimmedCode, userId, username });
      const users = await getRoomUsers(trimmedCode);
      const updatedRoom = await getRoom(trimmedCode);
      io.to(trimmedCode).emit('users-updated', { users, creator: updatedRoom?.creator || room.creator });
      return;
    }
    // The existing socket entry is stale (disconnected without cleanup) — remove it
    socketUsers.delete(existingSocketId);
  }

  // Determine if this is a creator reconnecting with their stored creatorToken
  // Token must match exactly — username match alone is not sufficient
  const isCreatorRejoin = creatorToken && room.creatorToken && creatorToken === room.creatorToken;

  // Cancel the pending 5-minute removal timer for this user (they're back)
  cancelPendingRemoval(userId);

  // If creator is reconnecting with a new userId (token matched but userId differs),
  // also cancel the removal timer for their old userId stored in the room record
  if (isCreatorRejoin && room.creator !== userId) {
    cancelPendingRemoval(room.creator);
  }

  // Look up the old presence entry for this userId (may exist from before disconnect)
  const existingUsers = await getRoomUsers(trimmedCode);
  const oldEntry = existingUsers[userId];
  // Support both legacy string format (username only) and new object format ({ username, joinedAt })
  const oldUsername = oldEntry ? (typeof oldEntry === 'string' ? oldEntry : oldEntry.username) : null;

  // Full stale cleanup before re-registering — prevents ghost entries in the user list:
  await removeUserFromRoom(trimmedCode, userId);     // Remove old entry by userId
  await removeUserByUsername(trimmedCode, username); // Remove any entry with new username
  if (oldUsername && oldUsername !== username) {
    await removeUserByUsername(trimmedCode, oldUsername); // Remove old username entries
    cleanStaleSocketEntries(trimmedCode, oldUsername);    // Clean in-memory map too
  }
  cleanStaleSocketEntries(trimmedCode, username);    // Clean in-memory by current username
  cleanStaleSocketEntriesById(trimmedCode, userId);  // Clean in-memory by userId (catches username changes)

  // Join the Socket.IO room group with the new socket ID
  socket.join(trimmedCode);

  // Register the new socket in the in-memory map
  socketUsers.set(socket.id, { roomId: trimmedCode, userId, username });

  // Re-add user to Redis presence hash with fresh joinedAt timestamp
  await addUserToRoom(trimmedCode, userId, username);

  // If this is a creator rejoin, update the room's creator field to the current userId
  // (the userId may be different from when the room was created if they rejoined via join-request)
  if (isCreatorRejoin) {
    await updateRoomCreator(trimmedCode, userId);
  }

  // Reset the room's TTL — activity means the room should live another 6 hours
  await refreshRoomTTL(trimmedCode);

  const updatedRoom = await getRoom(trimmedCode);
  const users = await getRoomUsers(trimmedCode);

  // CRITICAL ORDER: user-rejoined must arrive before users-updated on the client.
  // The frontend uses user-rejoined to remove the userId from offlineUserIds ref,
  // so that the subsequent users-updated doesn't re-add them as offline.
  io.to(trimmedCode).emit('user-rejoined', { userId, username });
  io.to(trimmedCode).emit('users-updated', { users, creator: updatedRoom?.creator || room.creator });

}

// ---------------------------------------------------------------------------
// Explicit leave: user clicked the "Leave Room" button intentionally.
// This is different from a network disconnect — the user will not reconnect.
// The user is removed immediately from Redis with no grace period.
// ---------------------------------------------------------------------------
async function handleLeaveRoom(socket, io) {
  const userData = socketUsers.get(socket.id);

  // Ignore if no session found or if the user is still in pending-approval state
  if (!userData || userData.pending) return;

  const { roomId, userId, username } = userData;

  // Set left=true so handleDisconnect (which fires right after this) skips cleanup
  // Without this flag, disconnect would re-trigger removal and double-notify the room
  userData.left = true;
  socketUsers.delete(socket.id); // Remove from in-memory socket map
  socket.leave(roomId);          // Leave the Socket.IO room group

  // Cancel any pending grace-period removal timer (in case one was running from a prior disconnect)
  cancelPendingRemoval(userId);

  // Remove immediately from Redis — no grace period for explicit leave
  await removeUserFromRoom(roomId, userId);

  // Emit 'user-left-room' (intentional leave) vs 'user-left' (network disconnect)
  // Clients display different messages: "left the room" vs just updating presence
  io.to(roomId).emit('user-left-room', { userId, username });

  // Check if the room is now completely empty
  const users = await getRoomUsers(roomId);
  if (Object.keys(users).length === 0) {
    // Destroy all Redis data for this room — no lingering orphaned keys
    await destroyRoom(roomId);
    console.log(`[Room] ${roomId} destroyed - no users remaining`);
  } else {
    // Room still has members — broadcast updated user list
    const roomData = await getRoom(roomId);
    if (roomData) {
      io.to(roomId).emit('users-updated', { users, creator: roomData.creator });
    }
  }
}

// ---------------------------------------------------------------------------
// Disconnect cleanup: socket lost (network drop, tab close, browser crash).
// Marks user as offline in the UI immediately, but delays Redis removal by
// 5 minutes to allow the user to reconnect without needing re-approval.
// ---------------------------------------------------------------------------

// Map: userId → NodeJS.Timeout handle for pending Redis removal
// Kept in memory so we can cancel the timer if the user reconnects in time
const pendingRemovals = new Map();

// Cancel and clear a pending removal timer for a given userId.
// Called by handleRejoinRoom and handleJoinRequest when a user comes back.
function cancelPendingRemoval(userId) {
  const timer = pendingRemovals.get(userId);
  if (timer) {
    clearTimeout(timer);          // Stop the scheduled Redis removal
    pendingRemovals.delete(userId); // Remove the timer reference from the map
  }
}

async function handleDisconnect(socket, io) {
  // Look up this socket's session data before cleaning up
  const userData = socketUsers.get(socket.id);
  if (!userData) return; // Socket had no associated session — nothing to do

  const { roomId, userId, username } = userData;

  // Remove socket from in-memory map regardless of path taken below
  socketUsers.delete(socket.id);

  // If the user explicitly left (handleLeaveRoom was called), cleanup is already done
  if (userData.left) return;

  // If the user was still pending approval and disconnected, no room notification needed
  if (userData.pending) return;

  // Check if this user has already reconnected on a different socket
  // (Socket.IO may fire 'connect' before 'disconnect' in some timing windows)
  const otherSocket = findSocketByUserId(io, userId, roomId);
  if (otherSocket) return; // User is alive on another socket — skip cleanup entirely

  // Immediately notify remaining room members: user is offline
  // 'user-left' keeps the user in the sidebar but shows them as offline (grey dot)
  io.to(roomId).emit('user-left', { userId, username });

  // Update the presence state to 'offline' for the user state indicator
  io.to(roomId).emit('user-state-changed', { userId, username, state: 'offline' });

  // Schedule Redis removal after the grace window.
  // This gives the user time to reconnect (e.g. brief network blip, phone sleep).
  // If they reconnect within 5 minutes, cancelPendingRemoval() stops this timer.
  const OFFLINE_GRACE_MS = 5 * 60 * 1000; // 5-minute grace period
  const timer = setTimeout(async () => {
    // Grace period expired — permanently remove user from room
    pendingRemovals.delete(userId);
    await removeUserFromRoom(roomId, userId);

    // Check if removing this user emptied the room
    const users = await getRoomUsers(roomId);
    if (Object.keys(users).length === 0) {
      // Room is empty — destroy all Redis data (metadata, users, pending requests)
      await destroyRoom(roomId);
      console.log(`[Room] ${roomId} destroyed - no users remaining`);
    } else {
      // Room still has members — broadcast updated user list without the departed user
      const roomData = await getRoom(roomId);
      if (roomData) {
        io.to(roomId).emit('users-updated', { users, creator: roomData.creator });
      }
    }
  }, OFFLINE_GRACE_MS);

  // Store the timer handle so it can be cancelled if the user rejoins
  pendingRemovals.set(userId, timer);
}

// ---------------------------------------------------------------------------
// Utility functions — internal helpers for socket lookup and cleanup
// ---------------------------------------------------------------------------

// Find the socket ID of a user in a specific room by their userId.
// Performs a linear scan of the in-memory socketUsers map.
// Returns the socket ID string, or null if not found.
// Used to locate pending users for approval/rejection and to detect active sockets.
function findSocketByUserId(io, userId, roomCode) {
  for (const [socketId, data] of socketUsers.entries()) {
    if (data.userId === userId && data.roomId === roomCode) {
      return socketId; // Found — return the socket ID
    }
  }
  return null; // Not found — user is offline or in a different room
}

// Remove all socketUsers entries where the username AND roomCode match.
// Used during rejoin to clean up entries that share the same display name.
// Safe to call even if no matching entries exist.
function cleanStaleSocketEntries(roomCode, username) {
  for (const [socketId, data] of socketUsers.entries()) {
    if (data.roomId === roomCode && data.username === username) {
      socketUsers.delete(socketId); // Remove stale entry
    }
  }
}

// Remove all socketUsers entries where the userId AND roomCode match.
// Used when the same userId may appear on multiple (stale) sockets.
// This can happen if the client fires rejoin-room before disconnect fires.
function cleanStaleSocketEntriesById(roomCode, userId) {
  for (const [socketId, data] of socketUsers.entries()) {
    if (data.roomId === roomCode && data.userId === userId) {
      socketUsers.delete(socketId); // Remove stale entry
    }
  }
}

// Return the session data for a given socket ID, or undefined if not found.
// Used by handlers.js to verify the sender is a valid room member.
function getSocketUser(socketId) {
  return socketUsers.get(socketId);
}

// ---------------------------------------------------------------------------
// User activity state (3-state presence): tracks whether a user's tab is
// visible or hidden. This is distinct from socket connection state.
//
// States: active (tab visible) ↔ inactive (tab hidden) ↔ offline (disconnected)
// The frontend emits 'user_inactive' / 'user_active' via the Visibility API.
// ---------------------------------------------------------------------------

// Called when the user switches away from the Ghost Chat tab (document.hidden = true)
// Updates the in-memory flag and broadcasts the 'inactive' state to the room
function handleUserInactive(socket, io) {
  const userData = socketUsers.get(socket.id);
  // Ignore if socket has no session or user is still pending approval
  if (!userData || userData.pending) return;

  // Mark as inactive in the in-memory session record
  userData.inactive = true;

  // Broadcast presence state change to everyone else in the room (not the user themselves)
  socket.to(userData.roomId).emit('user-state-changed', {
    userId: userData.userId,     // Identifies which user changed state
    username: userData.username, // For display in presence indicator
    state: 'inactive',           // Renders as grey/dim dot in UserList
  });
}

// Called when the user returns to the Ghost Chat tab (document.hidden = false)
// Clears the inactive flag and broadcasts the 'active' state to the room
function handleUserActive(socket, io) {
  const userData = socketUsers.get(socket.id);
  if (!userData || userData.pending) return;

  // Clear the inactive flag in the in-memory session record
  userData.inactive = false;

  // Broadcast presence state change to everyone else in the room
  socket.to(userData.roomId).emit('user-state-changed', {
    userId: userData.userId,
    username: userData.username,
    state: 'active',  // Renders as green dot in UserList
  });
}

// Export all handler functions and shared data structures for use in index.js
module.exports = {
  handleCreateRoom,    // 'create-room' event
  handleJoinRequest,   // 'join-request' event
  handleApproveJoin,   // 'approve-join' event
  handleRejectJoin,    // 'reject-join' event
  handleRejoinRoom,    // 'rejoin-room' event (auto-reconnect)
  handleLeaveRoom,     // 'leave-room' event (explicit leave)
  handleDisconnect,    // 'disconnect' event (socket-level)
  handleUserInactive,  // 'user_inactive' event
  handleUserActive,    // 'user_active' event
  getSocketUser,       // Used by handlers.js to look up socket sessions
  socketUsers,         // Exported for use in index.js /api/leave beacon handler
};
