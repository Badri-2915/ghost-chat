const { nanoid } = require('nanoid');
const {
  createRoom,
  getRoom,
  addUserToRoom,
  removeUserFromRoom,
  getRoomUsers,
  addJoinRequest,
  removeJoinRequest,
  getJoinRequests,
  refreshRoomTTL,
} = require('../redis');

// In-memory map: socketId -> { roomId, userId, username }
const socketUsers = new Map();

function generateRoomCode() {
  return nanoid(8);
}

function generateUserId() {
  return nanoid(12);
}

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

  io.to(roomCode).emit('users-updated', await getRoomUsers(roomCode));
}

async function handleJoinRequest(socket, io, { roomCode, username }) {
  const room = await getRoom(roomCode);

  if (!room) {
    socket.emit('error-message', { message: 'Room not found' });
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
      pendingSocket.emit('join-approved', { roomCode, userId, username: requestData.username });
    }
  }

  const users = await getRoomUsers(roomCode);
  io.to(roomCode).emit('users-updated', users);

  // Send updated pending list to creator
  const updatedRequests = await getJoinRequests(roomCode);
  socket.emit('join-requests-updated', updatedRequests);
}

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

async function handleDisconnect(socket, io) {
  const userData = socketUsers.get(socket.id);
  if (!userData) return;

  const { roomId, userId, username } = userData;
  socketUsers.delete(socket.id);

  if (userData.pending) return;

  await removeUserFromRoom(roomId, userId);
  const users = await getRoomUsers(roomId);
  io.to(roomId).emit('users-updated', users);
  io.to(roomId).emit('user-left', { userId, username });
}

function findSocketByUserId(io, userId, roomCode) {
  for (const [socketId, data] of socketUsers.entries()) {
    if (data.userId === userId && data.roomId === roomCode) {
      return socketId;
    }
  }
  return null;
}

function getSocketUser(socketId) {
  return socketUsers.get(socketId);
}

module.exports = {
  handleCreateRoom,
  handleJoinRequest,
  handleApproveJoin,
  handleRejectJoin,
  handleDisconnect,
  getSocketUser,
  socketUsers,
};
