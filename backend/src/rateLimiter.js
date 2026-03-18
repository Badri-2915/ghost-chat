const { checkRateLimit } = require('./redis');

// Rate limit: max messages per minute per user
const MESSAGE_LIMIT = 30;
const MESSAGE_WINDOW = 60; // seconds

// Rate limit: max connections per IP
const CONNECTION_LIMIT = 50;
const CONNECTION_WINDOW = 60; // seconds

async function rateLimitMessage(userId) {
  return checkRateLimit(`msg:${userId}`, MESSAGE_LIMIT, MESSAGE_WINDOW);
}

async function rateLimitConnection(ip) {
  return checkRateLimit(`conn:${ip}`, CONNECTION_LIMIT, CONNECTION_WINDOW);
}

module.exports = { rateLimitMessage, rateLimitConnection };
