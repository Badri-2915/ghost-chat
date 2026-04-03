// =============================================================================
// rateLimiter.js — Rate limiting for Ghost Chat.
// Uses Redis (or in-memory fallback) to enforce per-user message limits and
// per-IP connection limits within sliding time windows.
// =============================================================================

// Import the shared checkRateLimit helper from the storage layer
const { checkRateLimit } = require('./redis');

// Maximum messages a single user can send per window (prevents spam)
const MESSAGE_LIMIT = 30;

// Time window in seconds for the message rate limit (1 minute sliding window)
const MESSAGE_WINDOW = 60;

// Maximum new socket connections allowed per IP per window (prevents DoS)
const CONNECTION_LIMIT = 200;

// Time window in seconds for the connection rate limit (1 minute sliding window)
const CONNECTION_WINDOW = 60;

// Check whether a given userId is within the message rate limit.
// Returns true if allowed, false if the limit has been exceeded.
// Key is scoped to 'msg:<userId>' so each user has an independent counter.
async function rateLimitMessage(userId) {
  return checkRateLimit(`msg:${userId}`, MESSAGE_LIMIT, MESSAGE_WINDOW);
}

// Check whether a given IP address is within the connection rate limit.
// Returns true if allowed, false if the limit has been exceeded.
// Key is scoped to 'conn:<ip>' so each IP has an independent counter.
async function rateLimitConnection(ip) {
  return checkRateLimit(`conn:${ip}`, CONNECTION_LIMIT, CONNECTION_WINDOW);
}

// Export both rate limit functions for use in index.js (connection) and handlers.js (message)
module.exports = { rateLimitMessage, rateLimitConnection };
