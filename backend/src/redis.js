// =============================================================================
// Storage layer — Uses shared 2goi-redis with "gc:" key prefix.
// Falls back to in-memory if Redis is unavailable.
// =============================================================================

// ioredis is a full-featured Redis client for Node.js with promise support
const Redis = require('ioredis');

// All Ghost Chat keys are prefixed with "gc:" to avoid collisions with
// other apps (e.g. 2goi.in) sharing the same Redis instance
const P = 'gc:';

// The live Redis client instance — null until initRedis() is called
let redis = null;

// Flag: true when no REDIS_URL is set or Redis connection failed
// All functions check this flag to decide which backend to use
let useMemory = false;

// ---- In-memory fallback ----
// A plain JavaScript Map that mimics Redis SET/GET/DEL/EXPIRE semantics.
// Each entry stores { value, expiresAt } where expiresAt is a Unix ms timestamp.
const mem = new Map();

// Store a key with an optional TTL (in seconds).
// If ttlSeconds is provided, compute the absolute expiry timestamp.
function memSet(key, value, ttlSeconds) {
  const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
  mem.set(key, { value, expiresAt });
}

// Retrieve a key's value. Returns null if missing or expired.
// Expired entries are lazily deleted on access (no background scan needed per-read).
function memGet(key) {
  const entry = mem.get(key);
  if (!entry) return null; // Key does not exist
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    mem.delete(key); // Expired — delete and return null
    return null;
  }
  return entry.value; // Valid — return stored value
}

// Delete a key immediately from the in-memory store
function memDel(key) { mem.delete(key); }

// Update the TTL on an existing key without changing its value.
// Used by refreshRoomTTL to extend the room's lifetime on activity.
function memExpire(key, ttlSeconds) {
  const entry = mem.get(key);
  if (entry) entry.expiresAt = Date.now() + ttlSeconds * 1000;
}

// Background sweep: every 60 seconds, scan all keys and remove expired entries.
// This prevents unbounded memory growth from keys that were never accessed again.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of mem.entries()) {
    if (entry.expiresAt && now > entry.expiresAt) mem.delete(key);
  }
}, 60000);

// ---- Init ----
// Called once at server startup. Attempts to connect to Redis.
// If REDIS_URL is missing or connection fails, falls back to in-memory store.
async function initRedis() {
  const url = process.env.REDIS_URL; // e.g. "redis://default:password@host:6379"
  if (!url) {
    // No Redis URL configured — use in-memory store (useful for local dev)
    console.log('[Store] No REDIS_URL — using in-memory store');
    useMemory = true;
    return;
  }

  try {
    // Create ioredis client with retry strategy and lazy connect
    redis = new Redis(url, {
      maxRetriesPerRequest: 3,        // Retry each command up to 3 times before rejecting
      retryStrategy(times) {
        if (times > 5) return null;   // Give up after 5 connection retries
        return Math.min(times * 200, 5000); // Exponential backoff: 200ms, 400ms, 800ms... cap 5s
      },
      lazyConnect: true,              // Don't auto-connect on creation; we call connect() explicitly
      connectTimeout: 10000,          // Fail if connection not established within 10 seconds
    });

    // Log all Redis errors (network issues, auth failures, etc.) without crashing
    redis.on('error', (err) => {
      console.error('[Redis] Error:', err.message);
    });

    // Explicitly initiate the TCP connection to Redis
    await redis.connect();
    console.log('[Redis] Connected (shared with 2goi, prefix: gc:)');
  } catch (err) {
    // If connection fails at startup, fall back to in-memory store
    console.warn('[Redis] Connection failed, falling back to in-memory:', err.message);
    redis = null;
    useMemory = true;
  }
}

// ---- Room helpers ----

// Create a new room record in storage.
// Stores: creator userId, creator display name, secret creatorToken, creation timestamp.
// TTL: 6 hours — auto-expires if the room is abandoned without activity.
async function createRoom(roomId, creatorId, creatorName, creatorToken) {
  const data = { creator: creatorId, creatorName, creatorToken, createdAt: Date.now().toString() };
  if (useMemory) {
    memSet(`${P}room:${roomId}`, data, 6 * 60 * 60); // 6 hours TTL
  } else {
    await redis.hset(`${P}room:${roomId}`, data); // Redis HSET stores as hash fields
    await redis.expire(`${P}room:${roomId}`, 6 * 60 * 60); // Set 6-hour TTL on the hash
  }
}

// Fetch room metadata by room code. Returns null if room doesn't exist or has expired.
// The 'creator' field presence is the validity check — empty hashes return null.
async function getRoom(roomId) {
  if (useMemory) {
    const data = memGet(`${P}room:${roomId}`);
    return data && data.creator ? { ...data } : null; // Spread to return a copy
  }
  const data = await redis.hgetall(`${P}room:${roomId}`); // Get all fields of the hash
  return data && data.creator ? data : null; // Null if hash is empty (room gone)
}

// Update the creator field of a room after a creator rejoin.
// Called when the creator reconnects with a new userId (new socket → new ID).
// newCreatorToken is optional — only provided if the token itself needs to change.
async function updateRoomCreator(roomId, newCreatorId, newCreatorToken) {
  if (useMemory) {
    const data = memGet(`${P}room:${roomId}`);
    if (data) {
      data.creator = newCreatorId;                          // Replace creator userId
      if (newCreatorToken) data.creatorToken = newCreatorToken; // Optionally update token
      memSet(`${P}room:${roomId}`, data, 6 * 60 * 60);    // Re-save with fresh TTL
    }
  } else {
    const updates = { creator: newCreatorId };
    if (newCreatorToken) updates.creatorToken = newCreatorToken;
    await redis.hset(`${P}room:${roomId}`, updates); // Partial HSET — only updates named fields
  }
}

// Reset the room TTL to 6 hours from now. Called on every message send or join event.
// This prevents active rooms from expiring due to clock-based TTL.
async function refreshRoomTTL(roomId) {
  if (useMemory) {
    memExpire(`${P}room:${roomId}`, 6 * 60 * 60);       // Refresh room metadata key
    memExpire(`${P}room:${roomId}:users`, 6 * 60 * 60); // Refresh users hash key
  } else {
    await redis.expire(`${P}room:${roomId}`, 6 * 60 * 60);       // Redis EXPIRE resets TTL
    await redis.expire(`${P}room:${roomId}:users`, 6 * 60 * 60); // Also refresh users key
  }
}

// ---- Presence helpers ----

// Add or update a user in the room's user hash.
// The hash maps userId → { username, joinedAt } for all present users.
// TTL: 6 hours — same as the room itself.
async function addUserToRoom(roomId, userId, username) {
  const key = `${P}room:${roomId}:users`; // Redis hash: room members
  if (useMemory) {
    const users = memGet(key) || {};              // Load existing map or start empty
    users[userId] = { username, joinedAt: Date.now() }; // Upsert this user's entry
    memSet(key, users, 6 * 60 * 60);             // Save back with 6-hour TTL
  } else {
    // Redis HSET: field = userId, value = JSON-serialized user data
    await redis.hset(key, userId, JSON.stringify({ username, joinedAt: Date.now() }));
    await redis.expire(key, 6 * 60 * 60); // Ensure TTL is set (HSET doesn't reset TTL)
  }
}

// Remove a single user from the room's user hash by their userId.
// Called on explicit leave or when the grace-period timer fires after disconnect.
async function removeUserFromRoom(roomId, userId) {
  const key = `${P}room:${roomId}:users`;
  if (useMemory) {
    const users = memGet(key) || {};
    delete users[userId]; // Remove user entry by key
    memSet(key, users, 6 * 60 * 60); // Save updated map
  } else {
    await redis.hdel(key, userId); // Redis HDEL removes a single hash field
  }
}

// Remove ALL user entries that have a given username, regardless of userId.
// Used to clean up stale duplicate entries during creator rejoin or reconnect.
// This is necessary because a user may have a different userId after reconnect.
async function removeUserByUsername(roomId, username) {
  const key = `${P}room:${roomId}:users`;
  if (useMemory) {
    const users = memGet(key) || {};
    for (const [uid, data] of Object.entries(users)) {
      // Support both legacy string format and new object format
      const uname = typeof data === 'string' ? data : data.username;
      if (uname === username) delete users[uid]; // Remove any entry with this display name
    }
    memSet(key, users, 6 * 60 * 60);
  } else {
    const users = await redis.hgetall(key); // Get all fields in one round-trip
    for (const [uid, raw] of Object.entries(users)) {
      try {
        const data = JSON.parse(raw);
        if (data.username === username) await redis.hdel(key, uid); // Remove matching field
      } catch (e) { /* skip malformed entries silently */ }
    }
  }
}

// Return all users currently in a room as { userId: { username, joinedAt } }.
// Returns empty object if room has no users or does not exist.
async function getRoomUsers(roomId) {
  const key = `${P}room:${roomId}:users`;
  if (useMemory) {
    return memGet(key) || {}; // Return map or empty object
  }
  const users = await redis.hgetall(key); // Get all hash fields at once
  const result = {};
  for (const [id, data] of Object.entries(users)) {
    result[id] = JSON.parse(data); // Deserialize each JSON-encoded user object
  }
  return result;
}

// ---- Pending join requests ----

// Record a new join request from a user waiting for creator approval.
// TTL: 30 minutes — requests auto-expire if the creator never responds.
async function addJoinRequest(roomId, userId, username) {
  const key = `${P}room:${roomId}:pending`; // Separate hash for pending requests
  if (useMemory) {
    const reqs = memGet(key) || {};
    reqs[userId] = { username, requestedAt: Date.now() }; // Store request with timestamp
    memSet(key, reqs, 30 * 60); // 30-minute TTL
  } else {
    await redis.hset(key, userId, JSON.stringify({ username, requestedAt: Date.now() }));
    await redis.expire(key, 30 * 60); // 30-minute TTL
  }
}

// Remove a pending join request by userId — called on approve, reject, or cancel.
async function removeJoinRequest(roomId, userId) {
  const key = `${P}room:${roomId}:pending`;
  if (useMemory) {
    const reqs = memGet(key) || {};
    delete reqs[userId]; // Remove this specific request
    memSet(key, reqs, 30 * 60);
  } else {
    await redis.hdel(key, userId); // Remove single hash field
  }
}

// Return all pending join requests for a room as { userId: { username, requestedAt } }.
async function getJoinRequests(roomId) {
  const key = `${P}room:${roomId}:pending`;
  if (useMemory) {
    return memGet(key) || {}; // Return pending map or empty object
  }
  const requests = await redis.hgetall(key);
  const result = {};
  for (const [id, data] of Object.entries(requests)) {
    result[id] = JSON.parse(data); // Deserialize each request object
  }
  return result;
}

// ---- Message TTL storage ----

// Persist an encrypted message payload in Redis with a TTL matching the user's selection.
// The stored data is the encrypted payload (never plaintext) — server cannot read content.
// TTL mirrors the user-chosen message lifetime (5s to 300s).
async function storeMessage(roomId, messageId, encryptedData, ttlSeconds) {
  const key = `${P}msg:${roomId}:${messageId}`; // Unique key per message
  if (useMemory) {
    memSet(key, encryptedData, ttlSeconds); // Store with TTL
  } else {
    // Redis SET with EX option: atomically set key and expiry in one command
    await redis.set(key, JSON.stringify(encryptedData), 'EX', ttlSeconds);
  }
}

// Retrieve a stored message payload by its ID. Returns null if expired or not found.
// Used by handleDeleteMessage to look up the sender for permission checking.
async function getMessage(roomId, messageId) {
  const key = `${P}msg:${roomId}:${messageId}`;
  if (useMemory) {
    return memGet(key); // Returns null if expired
  }
  const data = await redis.get(key); // Returns null if key doesn't exist
  return data ? JSON.parse(data) : null;
}

// Permanently delete a message from storage before its TTL expires.
// Called when a user or creator manually deletes a message.
async function deleteMessage(roomId, messageId) {
  const key = `${P}msg:${roomId}:${messageId}`;
  if (useMemory) {
    memDel(key); // Immediate deletion from in-memory store
  } else {
    await redis.del(key); // Redis DEL removes the key immediately
  }
}

// ---- Room destruction ----

// Permanently delete all Redis data for a room: metadata, users, and pending requests.
// Called when the last user leaves (room is empty). Ensures no orphaned data remains.
async function destroyRoom(roomId) {
  // All three key patterns associated with a room's lifecycle
  const keys = [
    `${P}room:${roomId}`,           // Room metadata (creator, creatorToken, createdAt)
    `${P}room:${roomId}:users`,     // User presence hash (all room members)
    `${P}room:${roomId}:pending`,   // Pending join requests
  ];

  if (useMemory) {
    // Delete all three keys from in-memory store
    for (const key of keys) {
      memDel(key);
    }
  } else {
    // Redis DEL accepts multiple keys — deletes all atomically in one round-trip
    await redis.del(...keys);
  }
}

// ---- Rate limiting ----

// Generic sliding-window rate limiter using Redis INCR + EXPIRE.
// On first increment, sets the expiry window. Subsequent calls in the same window
// increment the counter. Returns true if under limit, false if exceeded.
async function checkRateLimit(identifier, maxRequests, windowSeconds) {
  const key = `${P}ratelimit:${identifier}`; // Scoped key: e.g. "gc:ratelimit:msg:userId123"
  if (useMemory) {
    const entry = memGet(key);
    const current = (entry || 0) + 1; // Increment counter (or start at 1)
    // Only set TTL on first increment (entry was null); don't reset window mid-period
    memSet(key, current, entry ? undefined : windowSeconds);
    return current <= maxRequests; // true = allowed, false = blocked
  }
  const current = await redis.incr(key); // Atomic increment — safe under concurrent load
  if (current === 1) {
    // First request in this window — set the expiry so window auto-resets
    await redis.expire(key, windowSeconds);
  }
  return current <= maxRequests; // true = allowed, false = rate limit exceeded
}

// Export all storage functions used by the rest of the application
module.exports = {
  initRedis,          // Called once at startup to connect to Redis
  createRoom,         // Create room metadata entry
  getRoom,            // Fetch room metadata
  updateRoomCreator,  // Update creator after rejoin
  refreshRoomTTL,     // Reset 6-hour TTL on activity
  addUserToRoom,      // Add/update user in presence hash
  removeUserFromRoom, // Remove user by userId
  removeUserByUsername, // Remove all entries with a given display name
  getRoomUsers,       // Get all current room members
  addJoinRequest,     // Record pending join request
  removeJoinRequest,  // Remove pending request (approve/reject)
  getJoinRequests,    // Get all pending requests for a room
  storeMessage,       // Store encrypted message with TTL
  getMessage,         // Retrieve message by ID (for delete permission check)
  deleteMessage,      // Permanently delete a message
  destroyRoom,        // Wipe all room data on empty room
  checkRateLimit,     // Generic rate limiting (messages + connections)
};
