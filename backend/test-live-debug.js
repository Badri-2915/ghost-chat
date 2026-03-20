// =============================================================================
// test-live-debug.js — Reproduce the EXACT 3 issues the user sees in browser
// This simulates real browser behavior with detailed logging
// =============================================================================

const { io } = require('socket.io-client');
const BASE = 'http://localhost:3001';

function createClient() {
  return io(BASE, { timeout: 5000, reconnection: false, forceNew: true });
}

function waitForEvent(client, event, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
    client.once(event, (data) => { clearTimeout(timer); resolve(data); });
  });
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// Collect ALL events on a client for debugging
function logAllEvents(client, label) {
  const events = ['user-left', 'user-state-changed', 'users-updated', 'user-rejoined',
    'new-message', 'message-status-update', 'error-message', 'join-approved', 'join-requested',
    'join-requests-updated', 'room-created'];
  events.forEach(ev => {
    client.on(ev, (data) => {
      console.log(`  [${label}] received "${ev}":`, JSON.stringify(data).substring(0, 200));
    });
  });
}

async function testIssue1_DisconnectShowingOnline() {
  console.log('\n' + '='.repeat(60));
  console.log('ISSUE 1: Does disconnect show user as offline?');
  console.log('='.repeat(60));

  const alice = createClient();
  await waitForEvent(alice, 'connect');
  logAllEvents(alice, 'Alice');

  // Alice creates room
  alice.emit('create-room', { username: 'Alice' });
  const room = await waitForEvent(alice, 'room-created');
  console.log(`\n1. Alice created room: ${room.roomCode}`);

  // Bob joins
  const bob = createClient();
  await waitForEvent(bob, 'connect');
  logAllEvents(bob, 'Bob');

  bob.emit('join-request', { roomCode: room.roomCode, username: 'Bob' });
  const req = await waitForEvent(alice, 'join-requests-updated');
  const bobPendingId = Object.keys(req)[0];
  alice.emit('approve-join', { roomCode: room.roomCode, userId: bobPendingId });
  const approved = await waitForEvent(bob, 'join-approved');
  console.log(`2. Bob joined with userId: ${approved.userId}`);

  await wait(500);

  // Now Bob disconnects (simulating network loss)
  console.log('\n3. Bob disconnecting (simulating network loss)...');
  bob.disconnect();

  // Wait and see what Alice receives
  console.log('4. Waiting 3 seconds to see what Alice receives...');
  await wait(3000);

  console.log('\n--- RESULT: If Alice received "user-left" and "user-state-changed: offline", issue 1 is FIXED ---');

  alice.disconnect();
  await wait(200);
  return room;
}

async function testIssue2_CreatorRejoin() {
  console.log('\n' + '='.repeat(60));
  console.log('ISSUE 2: Can creator rejoin with creatorToken?');
  console.log('='.repeat(60));

  // Scenario A: Creator creates room, Bob joins, Creator disconnects, Creator rejoins via rejoin-room
  const alice = createClient();
  await waitForEvent(alice, 'connect');

  alice.emit('create-room', { username: 'Alice' });
  const room = await waitForEvent(alice, 'room-created');
  const creatorToken = room.creatorToken;
  const aliceUserId = room.userId;
  console.log(`\n1. Alice created room: ${room.roomCode}, creatorToken: ${creatorToken}`);

  // Bob joins
  const bob = createClient();
  await waitForEvent(bob, 'connect');
  logAllEvents(bob, 'Bob');

  bob.emit('join-request', { roomCode: room.roomCode, username: 'Bob' });
  const req = await waitForEvent(alice, 'join-requests-updated');
  const bobPendingId = Object.keys(req)[0];
  alice.emit('approve-join', { roomCode: room.roomCode, userId: bobPendingId });
  await waitForEvent(bob, 'join-approved');
  console.log('2. Bob joined');

  await wait(500);

  // Alice disconnects
  console.log('\n3. Alice disconnecting...');
  alice.disconnect();
  await wait(1000);

  // Scenario A: Alice rejoins via rejoin-room (what happens on auto-reconnect)
  console.log('\n4. Alice rejoining via rejoin-room with creatorToken...');
  const alice2 = createClient();
  await waitForEvent(alice2, 'connect');
  logAllEvents(alice2, 'Alice2');

  alice2.emit('rejoin-room', {
    roomCode: room.roomCode,
    userId: aliceUserId,
    username: 'Alice',
    creatorToken: creatorToken
  });

  // Wait for events
  await wait(2000);

  // Check if Alice got an error
  console.log('\n--- Scenario A done. If no error-message, rejoin-room works ---');

  // Scenario B: Alice disconnects and tries join-request with creatorToken
  console.log('\n5. Alice2 disconnecting...');
  alice2.disconnect();
  await wait(1000);

  console.log('6. Alice3 trying join-request with creatorToken (simulating manual rejoin)...');
  const alice3 = createClient();
  await waitForEvent(alice3, 'connect');
  logAllEvents(alice3, 'Alice3');

  alice3.emit('join-request', {
    roomCode: room.roomCode,
    username: 'Alice',
    creatorToken: creatorToken
  });

  // Wait for response
  await wait(2000);

  console.log('\n--- Scenario B done. If got join-approved with isCreator:true, join-request path works ---');

  // Scenario C: Someone WITHOUT creatorToken tries to join while creator is absent
  console.log('\n7. Charlie trying to join without creatorToken while creator is gone...');
  alice3.disconnect();
  await wait(500);

  const charlie = createClient();
  await waitForEvent(charlie, 'connect');
  logAllEvents(charlie, 'Charlie');

  charlie.emit('join-request', {
    roomCode: room.roomCode,
    username: 'Charlie'
  });

  await wait(2000);

  console.log('\n--- Scenario C done. Should get "creator not available" error ---');

  bob.disconnect();
  charlie.disconnect();
  await wait(200);
}

async function testIssue3_MessageDelivery() {
  console.log('\n' + '='.repeat(60));
  console.log('ISSUE 3: Do messages deliver after reconnect?');
  console.log('='.repeat(60));

  const alice = createClient();
  await waitForEvent(alice, 'connect');
  logAllEvents(alice, 'Alice');

  alice.emit('create-room', { username: 'Alice' });
  const room = await waitForEvent(alice, 'room-created');
  console.log(`\n1. Alice created room: ${room.roomCode}`);

  // Bob joins
  const bob = createClient();
  await waitForEvent(bob, 'connect');

  bob.emit('join-request', { roomCode: room.roomCode, username: 'Bob' });
  const req = await waitForEvent(alice, 'join-requests-updated');
  const bobPendingId = Object.keys(req)[0];
  alice.emit('approve-join', { roomCode: room.roomCode, userId: bobPendingId });
  const bobApproved = await waitForEvent(bob, 'join-approved');
  const bobUserId = bobApproved.userId;
  console.log(`2. Bob joined with userId: ${bobUserId}`);

  await wait(500);

  // Bob disconnects
  console.log('\n3. Bob disconnecting...');
  bob.disconnect();
  await wait(1000);

  // Alice sends 5 messages while Bob is offline
  console.log('4. Alice sending 5 messages while Bob is offline...');
  for (let i = 1; i <= 5; i++) {
    alice.emit('send-message', {
      roomCode: room.roomCode,
      encryptedContent: `Offline message ${i}`,
      ttl: '5m'
    });
    await wait(200);
  }

  console.log('5. Waiting 1 second...');
  await wait(1000);

  // Bob reconnects
  console.log('6. Bob reconnecting...');
  const bob2 = createClient();
  await waitForEvent(bob2, 'connect');

  let receivedMessages = [];
  bob2.on('new-message', (msg) => {
    receivedMessages.push(msg.encryptedContent);
    console.log(`  [Bob2] received message: "${msg.encryptedContent}" status: ${msg.status}`);
  });

  bob2.emit('rejoin-room', {
    roomCode: room.roomCode,
    userId: bobUserId,
    username: 'Bob'
  });

  // Wait for messages to arrive
  await wait(3000);

  console.log(`\n--- RESULT: Bob received ${receivedMessages.length} missed messages (max 3 expected) ---`);
  console.log(`Messages: ${receivedMessages.join(', ')}`);

  if (receivedMessages.length === 0) {
    console.log('❌ ISSUE 3 STILL BROKEN: No messages delivered');
  } else if (receivedMessages.length <= 3) {
    console.log('✅ ISSUE 3 FIXED: Messages delivered (capped at 3)');
  }

  alice.disconnect();
  bob2.disconnect();
  await wait(200);
}

async function run() {
  console.log('🔍 LIVE DEBUG: Reproducing all 3 critical issues\n');

  await testIssue1_DisconnectShowingOnline();
  await testIssue2_CreatorRejoin();
  await testIssue3_MessageDelivery();

  console.log('\n' + '='.repeat(60));
  console.log('DEBUG COMPLETE');
  console.log('='.repeat(60));
  process.exit(0);
}

run().catch(err => { console.error('CRASH:', err); process.exit(1); });
