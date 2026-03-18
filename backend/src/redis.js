const Redis = require('ioredis');

let redis = null;
let subscriber = null;

function createRedisClient() {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      return delay;
    },
    lazyConnect: true,
  });

  client.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message);
  });

  client.on('connect', () => {
    console.log('[Redis] Connected');
  });

  return client;
}

async function initRedis() {
  redis = createRedisClient();
  subscriber = createRedisClient();
  await redis.connect();
  await subscriber.connect();
  return { redis, subscriber };
}

function getRedis() {
  return redis;
}

function getSubscriber() {
  return subscriber;
}

// Room helpers
async function createRoom(roomId, creatorId, creatorName) {
  const roomKey = `room:${roomId}`;
  await redis.hset(roomKey, {
    creator: creatorId,
    creatorName,
    createdAt: Date.now().toString(),
  });
  // Room expires after 6 hours of inactivity
  await redis.expire(roomKey, 6 * 60 * 60);
}

async function getRoom(roomId) {
  const roomKey = `room:${roomId}`;
  const data = await redis.hgetall(roomKey);
  if (!data || !data.creator) return null;
  return data;
}

async function refreshRoomTTL(roomId) {
  await redis.expire(`room:${roomId}`, 6 * 60 * 60);
}

// Presence helpers
async function addUserToRoom(roomId, userId, username) {
  const key = `room:${roomId}:users`;
  await redis.hset(key, userId, JSON.stringify({ username, joinedAt: Date.now() }));
  await redis.expire(key, 6 * 60 * 60);
}

async function removeUserFromRoom(roomId, userId) {
  const key = `room:${roomId}:users`;
  await redis.hdel(key, userId);
}

async function getRoomUsers(roomId) {
  const key = `room:${roomId}:users`;
  const users = await redis.hgetall(key);
  const result = {};
  for (const [id, data] of Object.entries(users)) {
    result[id] = JSON.parse(data);
  }
  return result;
}

// Pending join requests
async function addJoinRequest(roomId, userId, username) {
  const key = `room:${roomId}:pending`;
  await redis.hset(key, userId, JSON.stringify({ username, requestedAt: Date.now() }));
  await redis.expire(key, 60 * 30); // 30 min expiry
}

async function removeJoinRequest(roomId, userId) {
  const key = `room:${roomId}:pending`;
  await redis.hdel(key, userId);
}

async function getJoinRequests(roomId) {
  const key = `room:${roomId}:pending`;
  const requests = await redis.hgetall(key);
  const result = {};
  for (const [id, data] of Object.entries(requests)) {
    result[id] = JSON.parse(data);
  }
  return result;
}

// Message TTL storage (temporary buffer for ephemeral messages)
async function storeMessage(roomId, messageId, encryptedData, ttlSeconds) {
  const key = `msg:${roomId}:${messageId}`;
  await redis.set(key, JSON.stringify(encryptedData), 'EX', ttlSeconds);
}

async function getMessage(roomId, messageId) {
  const key = `msg:${roomId}:${messageId}`;
  const data = await redis.get(key);
  return data ? JSON.parse(data) : null;
}

async function deleteMessage(roomId, messageId) {
  const key = `msg:${roomId}:${messageId}`;
  await redis.del(key);
}

// Rate limiting
async function checkRateLimit(identifier, maxRequests, windowSeconds) {
  const key = `ratelimit:${identifier}`;
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, windowSeconds);
  }
  return current <= maxRequests;
}

module.exports = {
  initRedis,
  getRedis,
  getSubscriber,
  createRoom,
  getRoom,
  refreshRoomTTL,
  addUserToRoom,
  removeUserFromRoom,
  getRoomUsers,
  addJoinRequest,
  removeJoinRequest,
  getJoinRequests,
  storeMessage,
  getMessage,
  deleteMessage,
  checkRateLimit,
};
