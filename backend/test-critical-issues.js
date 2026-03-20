// =============================================================================
// test-critical-issues.js — Test the three critical issues reported
// 1. Users showing online when internet disconnects
// 2. Creator not able to rejoin
// 3. Single tick messages not delivering after reconnect
// =============================================================================

const { io } = require('socket.io-client');
const BASE = 'http://localhost:3001';

let passed = 0;
let failed = 0;
let total = 0;

function createClient() {
  return io(BASE, {
    timeout: 2000,
    reconnection: false,
    forceNew: true
  });
}

function waitForEvent(client, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    client.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function assert(condition, message) {
  total++;
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message}`);
    failed++;
  }
}

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test 1: Creator rejoin issue
async function testCreatorRejoin() {
  console.log('\n🧪 Test 1: Creator Rejoin');
  
  const creator = createClient();
  await waitForEvent(creator, 'connect');
  
  // Create room
  creator.emit('create-room', { username: 'Alice' });
  const createResp = await waitForEvent(creator, 'room-created');
  assert(createResp.isCreator, 'Creator marked as creator');
  assert(createResp.creatorToken, 'Creator has token');
  
  const roomCode = createResp.roomCode;
  const creatorToken = createResp.creatorToken;
  
  // Creator disconnects
  creator.disconnect();
  await wait(100);
  
  // Creator tries to rejoin
  const creator2 = createClient();
  await waitForEvent(creator2, 'connect');
  await wait(50);
  
  // This should work with creatorToken
  creator2.emit('join-request', { roomCode, username: 'Alice', creatorToken });
  
  try {
    const joinResp = await waitForEvent(creator2, 'join-approved', 3000);
    assert(joinResp.isCreator, 'Rejoined creator is marked as creator');
    assert(joinResp.creatorToken, 'Rejoined creator gets new token');
    console.log('  ✅ Creator rejoin SUCCESS');
  } catch (e) {
    // Check if got error instead
    try {
      const errorResp = await waitForEvent(creator2, 'error-message', 1000);
      console.log(`  ❌ Creator rejoin FAILED: ${errorResp.message}`);
      assert(false, `Creator rejoin failed: ${errorResp.message}`);
    } catch (e2) {
      console.log(`  ❌ Creator rejoin FAILED: No response`);
      assert(false, 'Creator rejoin failed: No response');
    }
  }
  
  creator2.disconnect();
}

// Test 2: Presence on disconnect
async function testPresenceOnDisconnect() {
  console.log('\n🧪 Test 2: Presence on Disconnect');
  
  const creator = createClient();
  const joiner = createClient();
  
  await waitForEvent(creator, 'connect');
  await waitForEvent(joiner, 'connect');
  
  // Create room
  creator.emit('create-room', { username: 'Alice' });
  const createResp = await waitForEvent(creator, 'room-created');
  const roomCode = createResp.roomCode;
  
  // Joiner joins
  joiner.emit('join-request', { roomCode, username: 'Bob' });
  const joinReq = await waitForEvent(creator, 'join-requests-updated');
  const joinerId = Object.keys(joinReq)[0];
  creator.emit('approve-join', { roomCode, userId: joinerId });
  await waitForEvent(joiner, 'join-approved');
  await wait(100);
  
  // Bob is now joined - check initial state
  await wait(100);
  console.log('  ℹ️ Bob joined successfully');
  
  // Bob disconnects
  joiner.disconnect();
  
  // Alice should receive user-left and user-state-changed: offline
  try {
    const leftEvent = await waitForEvent(creator, 'user-left', 2000);
    assert(leftEvent.username === 'Bob', 'User-left event received');
    
    const stateEvent = await waitForEvent(creator, 'user-state-changed', 2000);
    assert(stateEvent.state === 'offline', 'User state changed to offline');
    console.log('  ✅ Presence update on disconnect SUCCESS');
  } catch (e) {
    console.log(`  ❌ Presence update FAILED: ${e.message}`);
    assert(false, 'Presence update failed');
  }
  
  creator.disconnect();
}

// Test 3: Message delivery after reconnect
async function testMessageDeliveryAfterReconnect() {
  console.log('\n🧪 Test 3: Message Delivery After Reconnect');
  
  const creator = createClient();
  const joiner = createClient();
  
  await waitForEvent(creator, 'connect');
  await waitForEvent(joiner, 'connect');
  
  // Create room
  creator.emit('create-room', { username: 'Alice' });
  const createResp = await waitForEvent(creator, 'room-created');
  const roomCode = createResp.roomCode;
  
  // Joiner joins
  joiner.emit('join-request', { roomCode, username: 'Bob' });
  const joinReq = await waitForEvent(creator, 'join-requests-updated');
  const joinerId = Object.keys(joinReq)[0];
  creator.emit('approve-join', { roomCode, userId: joinerId });
  await waitForEvent(joiner, 'join-approved');
  await wait(100);
  
  // Joiner disconnects (simulate network loss)
  joiner.disconnect();
  await wait(500);
  
  // Alice sends messages while Bob is offline
  const messages = [];
  for (let i = 0; i < 3; i++) {
    creator.emit('new-message', { roomCode, encryptedContent: `Message ${i+1}`, ttl: 300 });
    messages.push(`Message ${i+1}`);
    await wait(100);
  }
  
  // Bob reconnects
  const bob2 = createClient();
  await waitForEvent(bob2, 'connect');
  await wait(50);
  
  // Bob rejoins
  bob2.emit('rejoin-room', { roomCode, userId: joinerId, username: 'Bob' });
  
  try {
    // Bob should receive the missed messages
    let receivedCount = 0;
    for (let i = 0; i < 5; i++) {
      try {
        const msg = await waitForEvent(bob2, 'new-message', 2000);
        if (msg.encryptedContent && messages.includes(msg.encryptedContent)) {
          receivedCount++;
        }
      } catch (e) {
        break;
      }
    }
    
    assert(receivedCount >= 2, `Bob received ${receivedCount}/3 missed messages`);
    console.log(`  ✅ Message delivery SUCCESS: ${receivedCount} messages received`);
  } catch (e) {
    console.log(`  ❌ Message delivery FAILED: ${e.message}`);
    assert(false, 'Message delivery failed');
  }
  
  creator.disconnect();
  bob2.disconnect();
}

// Run all tests
async function runTests() {
  console.log('🚀 Critical Issues Test Suite');
  console.log('=====================================\n');
  
  try {
    await testCreatorRejoin();
    await testPresenceOnDisconnect();
    await testMessageDeliveryAfterReconnect();
  } catch (err) {
    console.error(`\n💥 Test suite crashed: ${err.message}`);
    failed++;
    total++;
  }
  
  console.log('\n=====================================');
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${total} total\n`);
  
  if (failed > 0) {
    console.log('❌ Some tests failed - check implementation');
    process.exit(1);
  } else {
    console.log('✅ All critical tests passed!');
  }
}

runTests();
