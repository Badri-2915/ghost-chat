// Shared test helpers for Ghost Chat tests
const { io } = require('socket.io-client');
const BASE = 'http://localhost:3001';

const allSockets = new Set();

function client() {
  const c = io(BASE, { timeout: 5000, reconnection: false, forceNew: true });
  allSockets.add(c);
  return c;
}

function cleanup() {
  for (const s of allSockets) {
    try { s.removeAllListeners(); s.disconnect(); } catch (e) {}
  }
  allSockets.clear();
}

function waitFor(c, ev, ms = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for: ${ev}`)), ms);
    c.once(ev, (d) => { clearTimeout(t); resolve(d); });
  });
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

let passed = 0, failed = 0, total = 0;
function assert(cond, msg) {
  total++;
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ FAIL: ${msg}`); failed++; }
}

function results() {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 ${passed}/${total} passed, ${failed} failed`);
  if (failed === 0) console.log('🎉 ALL PASSED');
  else console.log('⚠️  FAILURES');
  return failed;
}

async function _createRoomAttempt(name) {
  const c = client();
  await waitFor(c, 'connect');
  c.emit('create-room', { username: name });
  const data = await waitFor(c, 'room-created');
  return { client: c, ...data };
}

async function createRoom(name = 'Alice') {
  try {
    return await _createRoomAttempt(name);
  } catch (e) {
    cleanup();
    await wait(2000);
    return await _createRoomAttempt(name);
  }
}

async function _setup2Attempt(name1, name2) {
  const creator = await createRoom(name1);
  const joiner = client();
  await waitFor(joiner, 'connect');
  const reqsP = waitFor(creator.client, 'join-requests-updated');
  joiner.emit('join-request', { roomCode: creator.roomCode, username: name2 });
  const reqs = await reqsP;
  const pid = Object.keys(reqs)[0];
  creator.client.emit('approve-join', { roomCode: creator.roomCode, userId: pid });
  const approved = await waitFor(joiner, 'join-approved');
  await wait(100);
  return { creator, joiner: { client: joiner, ...approved, username: name2 } };
}

async function setup2(name1 = 'Alice', name2 = 'Bob') {
  try {
    return await _setup2Attempt(name1, name2);
  } catch (e) {
    // Retry once after cleanup + longer wait (server may be processing old disconnects)
    cleanup();
    await wait(2000);
    return await _setup2Attempt(name1, name2);
  }
}

module.exports = { client, cleanup, waitFor, wait, assert, results, createRoom, setup2, BASE };
