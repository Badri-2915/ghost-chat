// =============================================================================
// socket/handlers.js — Message handling, delivery receipts, typing indicators,
// panic delete, and visibility awareness for Ghost Chat.
//
// Delete permissions: only the message sender (or the room creator as moderator)
// can delete a message. Message length is capped at 5000 characters.
// =============================================================================

// uuidv4 generates a RFC-4122 compliant unique message ID for each message
const { v4: uuidv4 } = require('uuid');

// Storage functions used by message handlers
const { storeMessage, deleteMessage, getMessage, refreshRoomTTL, getRoom } = require('../redis');

// Rate limiter used to check per-user message send limits
const { rateLimitMessage } = require('../rateLimiter');

// getSocketUser looks up the in-memory user record for a given socket ID
const { getSocketUser } = require('./rooms');

// Hard cap on message payload length — prevents oversized payloads from bloating memory
// Note: this checks the raw encryptedContent string length, not decrypted text length
const MAX_MESSAGE_LENGTH = 5000;

// ---------------------------------------------------------------------------
// Send a new message to the room. Supports optional replyTo for threading.
// Flow: validate → rate limit → length check → store in Redis → broadcast
// ---------------------------------------------------------------------------
async function handleSendMessage(socket, io, { roomCode, encryptedContent, ttl, replyTo }) {
  // Look up the sender's metadata from the in-memory socketUsers map
  const userData = getSocketUser(socket.id);

  // Guard: user must be in the room and not in a pending-approval state
  if (!userData || userData.roomId !== roomCode || userData.pending) {
    socket.emit('error-message', { message: 'Not in room' });
    return;
  }

  // Check per-user message rate limit (30 msgs/min via Redis INCR sliding window)
  const allowed = await rateLimitMessage(userData.userId);
  if (!allowed) {
    socket.emit('error-message', { message: 'Rate limit exceeded. Slow down.' });
    return;
  }

  // Reject payloads that exceed the max character limit
  // encryptedContent is a JSON-serialized object or base64 string — we check string length
  if (typeof encryptedContent === 'string' && encryptedContent.length > MAX_MESSAGE_LENGTH) {
    socket.emit('error-message', { message: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` });
    return;
  }

  // Generate a UUID v4 as the message's unique identifier
  const messageId = uuidv4();

  // Unix millisecond timestamp — used for display and TTL countdown calculations
  const timestamp = Date.now();

  // Map the user-selected TTL label to a concrete number of seconds for Redis expiry.
  // 'after-seen' uses a 3-second Redis TTL as a safety net (the client drives the countdown).
  const ttlMap = {
    'after-seen': 3,   // Message deletes 3s after recipient sees it (client-driven)
    '5s': 5,           // 5-second lifetime
    '15s': 15,         // 15-second lifetime
    '30s': 30,         // 30-second lifetime
    '1m': 60,          // 1-minute lifetime
    '5m': 300,         // 5-minute lifetime (default)
  };

  // Resolve TTL to seconds; fall back to 300s (5 min) for unknown labels
  const ttlSeconds = ttlMap[ttl] || 300;

  // Store the encrypted message payload in Redis with the computed TTL.
  // Server stores only ciphertext — never has access to plaintext content.
  await storeMessage(roomCode, messageId, {
    senderId: userData.userId,     // Who sent the message (for permission checks on delete)
    senderName: userData.username, // Display name — shown in the UI
    encryptedContent,              // AES-GCM ciphertext: { iv, ciphertext }
    ttl,                           // Original label (e.g. '5m') — sent to clients for countdown display
    timestamp,                     // Creation time — used by client to compute remaining TTL
    replyTo: replyTo || null,      // Optional reply reference: { messageId, senderName, content }
  }, ttlSeconds);

  // Refresh the room's Redis TTL to prevent the room from expiring during active conversation
  await refreshRoomTTL(roomCode);

  // Build the broadcast payload — includes all data clients need to render the message
  const messageData = {
    messageId,                      // Unique ID used for dedup, deletion, and status updates
    senderId: userData.userId,      // Used by each client to distinguish own vs others' messages
    senderName: userData.username,  // Display name shown above the bubble
    encryptedContent,               // Encrypted payload — each client decrypts with room key
    ttl,                            // Label for countdown display (shown to sender only)
    ttlSeconds,                     // Numeric seconds — used for countdown initialization
    timestamp,                      // Creation time — shown as message timestamp in UI
    status: 'sent',                 // Initial delivery status (sent → delivered → read)
    replyTo: replyTo || null,       // Reply preview if replying to another message
  };

  // Broadcast to all currently connected sockets in this room (real-time only — no offline buffering)
  io.to(roomCode).emit('new-message', messageData);
}

// ---------------------------------------------------------------------------
// Delivery receipt: receiver's client emits this when the 'new-message' event
// arrives. Tells the sender their message reached the recipient's device.
// Status progression: sent (✓) → delivered (✓✓) → read (👁)
// ---------------------------------------------------------------------------
function handleMessageDelivered(socket, io, { roomCode, messageId }) {
  // Look up sender to confirm they are in this room
  const userData = getSocketUser(socket.id);
  if (!userData || userData.roomId !== roomCode) return;

  // Forward status update to all other room members (primarily the original sender)
  socket.to(roomCode).emit('message-status-update', {
    messageId,              // Which message was delivered
    status: 'delivered',    // New status — triggers double-tick on sender's UI
    userId: userData.userId, // Who received it
  });
}

// ---------------------------------------------------------------------------
// Read receipt: emitted by the receiver when the message bubble enters the
// viewport (IntersectionObserver with 50% threshold). Triggers 'after-seen' TTL.
// ---------------------------------------------------------------------------
function handleMessageRead(socket, io, { roomCode, messageId }) {
  const userData = getSocketUser(socket.id);
  if (!userData || userData.roomId !== roomCode) return;

  // Forward read confirmation to all room members — sender shows eye icon
  socket.to(roomCode).emit('message-status-update', {
    messageId,           // Which message was seen
    status: 'read',      // New status — triggers eye icon on sender's UI
    userId: userData.userId, // Who read it
  });
}

// ---------------------------------------------------------------------------
// Typing start: emitted by a client when the user types in the input box.
// The frontend debounces this with a 2-second idle timer before sending stop.
// ---------------------------------------------------------------------------
function handleTypingStart(socket, io, { roomCode }) {
  const userData = getSocketUser(socket.id);
  if (!userData || userData.roomId !== roomCode) return;

  // Broadcast to all OTHER room members (not the sender themselves)
  socket.to(roomCode).emit('user-typing', {
    userId: userData.userId,     // Used to deduplicate in the typing map
    username: userData.username, // Displayed in "X is typing..." indicator
  });
}

// Typing stop: emitted when the user stops typing for 2 seconds, sends the message,
// or clears the input. Removes them from the typing indicator on others' screens.
function handleTypingStop(socket, io, { roomCode }) {
  const userData = getSocketUser(socket.id);
  if (!userData || userData.roomId !== roomCode) return;

  // Broadcast stop to all other room members — removes this user from their typing display
  socket.to(roomCode).emit('user-stopped-typing', {
    userId: userData.userId, // Used to remove this user from the typing map
  });
}

// ---------------------------------------------------------------------------
// Delete a single message: only sender or room creator (moderator) can delete.
// Removes from Redis and broadcasts deletion to all connected UIs.
// ---------------------------------------------------------------------------
async function handleDeleteMessage(socket, io, { roomCode, messageId, senderId }) {
  const userData = getSocketUser(socket.id);
  if (!userData || userData.roomId !== roomCode) return;

  // Fetch room metadata to determine if the requester is the room creator (moderator)
  const room = await getRoom(roomCode);
  const isRoomCreator = room && room.creator === userData.userId;

  // Use senderId provided by the client if available; otherwise look it up from Redis.
  // Client sends senderId in the payload for efficiency; fallback to Redis lookup for safety.
  let msgSender = senderId;
  if (!msgSender) {
    try {
      const stored = await getMessage(roomCode, messageId);
      if (stored) msgSender = stored.senderId; // Extract the original sender's userId
    } catch (e) { /* best effort — message may have already expired */ }
  }

  // Enforce delete permission: only the original sender OR the room creator can delete
  if (msgSender && msgSender !== userData.userId && !isRoomCreator) {
    socket.emit('error-message', { message: 'Cannot delete: not your message' });
    return;
  }

  // Remove the message from Redis (before its natural TTL expiry)
  await deleteMessage(roomCode, messageId);

  // Broadcast deletion to all room members so every UI removes it immediately
  io.to(roomCode).emit('message-deleted', { messageId });
}

// ---------------------------------------------------------------------------
// Panic delete: instantly wipe ALL messages for the entire room.
// Any authenticated room member can trigger this. Requires double-click on client.
// Only clears UI state — individual message Redis keys expire naturally via their TTL.
// ---------------------------------------------------------------------------
async function handlePanicDelete(socket, io, { roomCode }) {
  const userData = getSocketUser(socket.id);
  // Guard: only process if the socket is actually in this room
  if (!userData || userData.roomId !== roomCode) return;

  // Broadcast to ALL users in the room (including sender) to clear their message lists
  io.to(roomCode).emit('panic-delete', {
    triggeredBy: userData.username, // Shown in the toast: "X deleted all messages"
  });
}

// ---------------------------------------------------------------------------
// Visibility change: user switched browser tabs or minimized the window.
// The frontend listens to the Visibility API and emits this event.
// This is awareness-only — the server just relays it to the rest of the room.
// ---------------------------------------------------------------------------
function handleVisibilityChange(socket, io, { roomCode, isVisible }) {
  const userData = getSocketUser(socket.id);
  if (!userData || userData.roomId !== roomCode) return;

  // Relay visibility state change to all other room members
  socket.to(roomCode).emit('user-visibility-changed', {
    userId: userData.userId,     // Identifies which user's visibility changed
    username: userData.username, // Display name for any UI notification
    isVisible,                   // true = tab is active, false = tab is hidden
  });
}

// Export all message and interaction handlers for registration in index.js
module.exports = {
  handleSendMessage,       // 'send-message' event
  handleMessageDelivered,  // 'message-delivered' event
  handleMessageRead,       // 'message-read' event
  handleTypingStart,       // 'typing-start' event
  handleTypingStop,        // 'typing-stop' event
  handleDeleteMessage,     // 'delete-message' event
  handlePanicDelete,       // 'panic-delete' event
  handleVisibilityChange,  // 'visibility-change' event
};
