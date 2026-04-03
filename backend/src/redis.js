// =============================================================================
// Storage layer — Uses shared 2goi-redis with "gc:" key prefix.
// Falls back to in-memory if Redis is unavailable.
// =============================================================================

const Redis = require('ioredis');

// Key prefix to avoid collisions with 2goi data in shared Redis
const P = 'gc:';

let redis = null;
let useMemory = false;

// ---- In-memory fallback ----
const mem = new Map();

function memSet(key, value, ttlSeconds) {
  const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
  mem.set(key, { value, expiresAt });
}

function memGet(key) {
  const entry = mem.get(key);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    mem.delete(key);
    return null;
  }
  return entry.value;
}

function memDel(key) { mem.delete(key); }

function memExpire(key, ttlSeconds) {
  const entry = mem.get(key);
  if (entry) entry.expiresAt = Date.now() + ttlSeconds * 1000;
}

// Cleanup expired keys every 60s
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of mem.entries()) {
    if (entry.expiresAt && now > entry.expiresAt) mem.delete(key);
  }
}, 60000);

// ---- Init ----
async function initRedis() {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.log('[Store] No REDIS_URL — using in-memory store');
    useMemory = true;
    return;
  }

  try {
    redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) return null;
        return Math.min(times * 200, 5000);
      },
      lazyConnect: true,
      connectTimeout: 10000,
    });

    redis.on('error', (err) => {
      console.error('[Redis] Error:', err.message);
    });

    await redis.connect();
    console.log('[Redis] Connected (shared with 2goi, prefix: gc:)');
  } catch (err) {
    console.warn('[Redis] Connection failed, falling back to in-memory:', err.message);
    redis = null;
    useMemory = true;
  }
}

// ---- Room helpers ----
async function createRoom(roomId, creatorId, creatorName, creatorToken) {
  const data = { creator: creatorId, creatorName, creatorToken, createdAt: Date.now().toString() };
  if (useMemory) {
    memSet(`${P}room:${roomId}`, data, 6 * 60 * 60);
  } else {
    await redis.hset(`${P}room:${roomId}`, data);
    await redis.expire(`${P}room:${roomId}`, 6 * 60 * 60);
  }
}

async function getRoom(roomId) {
  if (useMemory) {
    const data = memGet(`${P}room:${roomId}`);
    return data && data.creator ? { ...data } : null;
  }
  const data = await redis.hgetall(`${P}room:${roomId}`);
  return data && data.creator ? data : null;
}

async function updateRoomCreator(roomId, newCreatorId, newCreatorToken) {
  if (useMemory) {
    const data = memGet(`${P}room:${roomId}`);
    if (data) {
      data.creator = newCreatorId;
      if (newCreatorToken) data.creatorToken = newCreatorToken;
      memSet(`${P}room:${roomId}`, data, 6 * 60 * 60);
    }
  } else {
    const updates = { creator: newCreatorId };
    if (newCreatorToken) updates.creatorToken = newCreatorToken;
    await redis.hset(`${P}room:${roomId}`, updates);
  }
}

async function refreshRoomTTL(roomId) {
  if (useMemory) {
    memExpire(`${P}room:${roomId}`, 6 * 60 * 60);
    memExpire(`${P}room:${roomId}:users`, 6 * 60 * 60);
  } else {
    await redis.expire(`${P}room:${roomId}`, 6 * 60 * 60);
    await redis.expire(`${P}room:${roomId}:users`, 6 * 60 * 60);
  }
}

// ---- Presence helpers ----
async function addUserToRoom(roomId, userId, username) {
  const key = `${P}room:${roomId}:users`;
  if (useMemory) {
    const users = memGet(key) || {};
    users[userId] = { username, joinedAt: Date.now() };
    memSet(key, users, 6 * 60 * 60);
  } else {
    await redis.hset(key, userId, JSON.stringify({ username, joinedAt: Date.now() }));
    await redis.expire(key, 6 * 60 * 60);
  }
}

async function removeUserFromRoom(roomId, userId) {
  const key = `${P}room:${roomId}:users`;
  if (useMemory) {
    const users = memGet(key) || {};
    delete users[userId];
    memSet(key, users, 6 * 60 * 60);
  } else {
    await redis.hdel(key, userId);
  }
}

// Remove ALL user entries for a given username (prevents duplicates on rejoin)
async function removeUserByUsername(roomId, username) {
  const key = `${P}room:${roomId}:users`;
  if (useMemory) {
    const users = memGet(key) || {};
    for (const [uid, data] of Object.entries(users)) {
      const uname = typeof data === 'string' ? data : data.username;
      if (uname === username) delete users[uid];
    }
    memSet(key, users, 6 * 60 * 60);
  } else {
    const users = await redis.hgetall(key);
    for (const [uid, raw] of Object.entries(users)) {
      try {
        const data = JSON.parse(raw);
        if (data.username === username) await redis.hdel(key, uid);
      } catch (e) { /* skip malformed */ }
    }
  }
}

async function getRoomUsers(roomId) {
  const key = `${P}room:${roomId}:users`;
  if (useMemory) {
    return memGet(key) || {};
  }
  const users = await redis.hgetall(key);
  const result = {};
  for (const [id, data] of Object.entries(users)) {
    result[id] = JSON.parse(data);
  }
  return result;
}

// ---- Pending join requests ----
async function addJoinRequest(roomId, userId, username) {
  const key = `${P}room:${roomId}:pending`;
  if (useMemory) {
    const reqs = memGet(key) || {};
    reqs[userId] = { username, requestedAt: Date.now() };
    memSet(key, reqs, 30 * 60);
  } else {
    await redis.hset(key, userId, JSON.stringify({ username, requestedAt: Date.now() }));
    await redis.expire(key, 30 * 60);
  }
}

async function removeJoinRequest(roomId, userId) {
  const key = `${P}room:${roomId}:pending`;
  if (useMemory) {
    const reqs = memGet(key) || {};
    delete reqs[userId];
    memSet(key, reqs, 30 * 60);
  } else {
    await redis.hdel(key, userId);
  }
}

async function getJoinRequests(roomId) {
  const key = `${P}room:${roomId}:pending`;
  if (useMemory) {
    return memGet(key) || {};
  }
  const requests = await redis.hgetall(key);
  const result = {};
  for (const [id, data] of Object.entries(requests)) {
    result[id] = JSON.parse(data);
  }
  return result;
}

// ---- Message TTL storage ----
async function storeMessage(roomId, messageId, encryptedData, ttlSeconds) {
  const key = `${P}msg:${roomId}:${messageId}`;
  if (useMemory) {
    memSet(key, encryptedData, ttlSeconds);
  } else {
    await redis.set(key, JSON.stringify(encryptedData), 'EX', ttlSeconds);
  }
}

async function getMessage(roomId, messageId) {
  const key = `${P}msg:${roomId}:${messageId}`;
  if (useMemory) {
    return memGet(key);
  }
  const data = await redis.get(key);
  return data ? JSON.parse(data) : null;
}

async function deleteMessage(roomId, messageId) {
  const key = `${P}msg:${roomId}:${messageId}`;
  if (useMemory) {
    memDel(key);
  } else {
    await redis.del(key);
  }
}

// ---- Room destruction ----
async function destroyRoom(roomId) {
  // Delete all Redis keys associated with this room
  const keys = [
    `${P}room:${roomId}`,           // Room metadata
    `${P}room:${roomId}:users`,     // Users list
    `${P}room:${roomId}:pending`,   // Join requests
  ];
  
  if (useMemory) {
    for (const key of keys) {
      memDel(key);
    }
  } else {
    await redis.del(...keys);
  }
}

// ---- Rate limiting ----
async function checkRateLimit(identifier, maxRequests, windowSeconds) {
  const key = `${P}ratelimit:${identifier}`;
  if (useMemory) {
    const entry = memGet(key);
    const current = (entry || 0) + 1;
    memSet(key, current, entry ? undefined : windowSeconds);
    return current <= maxRequests;
  }
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, windowSeconds);
  }
  return current <= maxRequests;
}

module.exports = {
  initRedis,
  createRoom,
  getRoom,
  updateRoomCreator,
  refreshRoomTTL,
  addUserToRoom,
  removeUserFromRoom,
  removeUserByUsername,
  getRoomUsers,
  addJoinRequest,
  removeJoinRequest,
  getJoinRequests,
  storeMessage,
  getMessage,
  deleteMessage,
  destroyRoom,
  checkRateLimit,
};
