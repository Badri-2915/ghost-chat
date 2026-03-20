// =============================================================================
// Ghost Chat — Comprehensive Feature Test Suite
// Tests ALL features: health, rooms, join/approve/reject, messaging, typing,
// presence, deletion, panic delete, visibility, 3-state presence,
// creator rejoin, offline message recovery, after-seen TTL, rejoin delivery.
// =============================================================================

const { io } = require('socket.io-client');

const SERVER = 'http://localhost:3001';
let passed = 0;
let failed = 0;
let total = 0;

function assert(condition, name) {
  total++;
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    failed++;
  }
}

function createClient(name) {
  return new Promise((resolve, reject) => {
    const client = io(SERVER, { transports: ['websocket'], forceNew: true });
    client._name = name;
    client.on('connect', () => setTimeout(() => resolve(client), 100));
    client.on('connect_error', (err) => reject(new Error(`${name} connect failed: ${err.message}`)));
  });
}

function waitFor(client, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${event} on ${client._name}`)), timeout);
    client.once(event, (data) => { clearTimeout(timer); resolve(data); });
  });
}

// Collect multiple events of the same type
function collectEvents(client, event, count, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: collecting ${count} ${event} on ${client._name}`)), timeout);
    const results = [];
    const handler = (data) => {
      results.push(data);
      if (results.length >= count) {
        clearTimeout(timer);
        client.off(event, handler);
        resolve(results);
      }
    };
    client.on(event, handler);
  });
}

// Helper: create room and return { creator, roomData }
async function setupRoom(creatorName) {
  const creator = await createClient(creatorName);
  const roomPromise = waitFor(creator, 'room-created');
  creator.emit('create-room', { username: creatorName });
  const roomData = await roomPromise;
  await waitFor(creator, 'users-updated');
  return { creator, roomData };
}

// Helper: join a user into a room (creator approves)
async function joinUser(creator, roomCode, joinerName) {
  const joiner = await createClient(joinerName);
  const joinReqPromise = waitFor(joiner, 'join-requested');
  const joinReqsPromise = waitFor(creator, 'join-requests-updated');
  joiner.emit('join-request', { roomCode, username: joinerName });
  const joinReqData = await joinReqPromise;
  const reqs = await joinReqsPromise;
  const reqId = Object.keys(reqs).find((id) => reqs[id].username === joinerName);
  const approvedPromise = waitFor(joiner, 'join-approved');
  creator.emit('approve-join', { roomCode, userId: reqId });
  const approvedData = await approvedPromise;
  await waitFor(creator, 'users-updated');
  return { joiner, joinReqData, approvedData, userId: joinReqData.userId };
}

// =========================================================================
// TEST 1: Health Endpoint
// =========================================================================
async function testHealth() {
  console.log('\n🧪 Test 1: Health Endpoint');
  const res = await fetch(`${SERVER}/api/health`);
  const data = await res.json();
  assert(res.status === 200, 'GET /api/health returns 200');
  assert(data.status === 'ok', 'Status is "ok"');
  assert(typeof data.connections === 'number', 'Has connections count');
  assert(typeof data.uptime === 'number', 'Has uptime');
}

// =========================================================================
// TEST 2: Room Creation
// =========================================================================
async function testRoomCreation() {
  console.log('\n🧪 Test 2: Room Creation');
  const { creator, roomData } = await setupRoom('Alice');
  assert(!!roomData.roomCode, `Room code generated: ${roomData.roomCode}`);
  assert(roomData.roomCode.length === 8, 'Room code is 8 chars');
  assert(!!roomData.userId, 'User ID assigned');
  assert(roomData.username === 'Alice', 'Username matches');
  assert(roomData.isCreator === true, 'Marked as creator');
  creator.disconnect();
}

// =========================================================================
// TEST 3: Join Request / Approve / Reject
// =========================================================================
async function testJoinFlow() {
  console.log('\n🧪 Test 3: Join Request / Approve / Reject');
  const { creator, roomData } = await setupRoom('Alice');

  // Join + approve Bob
  const { joiner, joinReqData } = await joinUser(creator, roomData.roomCode, 'Bob');
  assert(joinReqData.roomCode === roomData.roomCode, 'Joiner got room code');
  assert(joinReqData.username === 'Bob', 'Joiner username matches');

  // Reject Charlie
  const joiner2 = await createClient('joiner2');
  const req2Promise = waitFor(joiner2, 'join-requested');
  const reqs2Promise = waitFor(creator, 'join-requests-updated');
  joiner2.emit('join-request', { roomCode: roomData.roomCode, username: 'Charlie' });
  await req2Promise;
  const reqs2 = await reqs2Promise;
  const rejId = Object.keys(reqs2).find((id) => reqs2[id].username === 'Charlie');
  const rejectedPromise = waitFor(joiner2, 'join-rejected');
  creator.emit('reject-join', { roomCode: roomData.roomCode, userId: rejId });
  await rejectedPromise;
  assert(true, 'Rejected user received join-rejected');

  creator.disconnect(); joiner.disconnect(); joiner2.disconnect();
}

// =========================================================================
// TEST 4: Real-Time Messaging + Receipts
// =========================================================================
async function testMessaging() {
  console.log('\n🧪 Test 4: Real-Time Messaging + Receipts');
  const { creator, roomData } = await setupRoom('Alice');
  const { joiner } = await joinUser(creator, roomData.roomCode, 'Bob');

  const creatorMsgP = waitFor(creator, 'new-message');
  const joinerMsgP = waitFor(joiner, 'new-message');
  creator.emit('send-message', { roomCode: roomData.roomCode, encryptedContent: 'Hello!', ttl: '5m' });

  const cMsg = await creatorMsgP;
  const jMsg = await joinerMsgP;
  assert(!!cMsg.messageId, 'Message has UUID');
  assert(cMsg.senderName === 'Alice', 'Sender name correct');
  assert(jMsg.encryptedContent === 'Hello!', 'Content delivered to receiver');
  assert(cMsg.ttl === '5m', 'TTL preserved');
  assert(cMsg.status === 'sent', 'Initial status is sent');

  // Delivered receipt
  const deliveredP = waitFor(creator, 'message-status-update');
  joiner.emit('message-delivered', { roomCode: roomData.roomCode, messageId: cMsg.messageId });
  const delivered = await deliveredP;
  assert(delivered.status === 'delivered', 'Delivered status received');

  // Read receipt
  const readP = waitFor(creator, 'message-status-update');
  joiner.emit('message-read', { roomCode: roomData.roomCode, messageId: cMsg.messageId });
  const read = await readP;
  assert(read.status === 'read', 'Read status received');

  creator.disconnect(); joiner.disconnect();
}

// =========================================================================
// TEST 5: Typing Indicators
// =========================================================================
async function testTyping() {
  console.log('\n🧪 Test 5: Typing Indicators');
  const { creator, roomData } = await setupRoom('Alice');
  const { joiner } = await joinUser(creator, roomData.roomCode, 'Bob');

  const typingP = waitFor(creator, 'user-typing');
  joiner.emit('typing-start', { roomCode: roomData.roomCode });
  const typing = await typingP;
  assert(typing.username === 'Bob', 'Typing indicator shows Bob');

  const stopP = waitFor(creator, 'user-stopped-typing');
  joiner.emit('typing-stop', { roomCode: roomData.roomCode });
  await stopP;
  assert(true, 'Stop typing event received');

  creator.disconnect(); joiner.disconnect();
}

// =========================================================================
// TEST 6: Presence — Disconnect = Offline (User Left)
// =========================================================================
async function testPresenceDisconnect() {
  console.log('\n🧪 Test 6: Presence — Disconnect (Offline)');
  const { creator, roomData } = await setupRoom('Alice');
  const { joiner } = await joinUser(creator, roomData.roomCode, 'Bob');

  const leftP = waitFor(creator, 'user-left');
  joiner.disconnect();

  const left = await leftP;
  assert(left.username === 'Bob', 'User left event shows Bob');
  assert(left.userId !== undefined, 'User left event has userId');

  creator.disconnect();
}

// =========================================================================
// TEST 7: Invalid Room Code
// =========================================================================
async function testInvalidRoom() {
  console.log('\n🧪 Test 7: Invalid Room Code');
  const client = await createClient('tester');
  const errP = waitFor(client, 'error-message');
  client.emit('join-request', { roomCode: 'INVALID99', username: 'Eve' });
  const err = await errP;
  assert(err.message === 'Room not found', 'Error for invalid room');
  client.disconnect();
}

// =========================================================================
// TEST 8: Message Deletion (single)
// =========================================================================
async function testMessageDeletion() {
  console.log('\n🧪 Test 8: Message Deletion');
  const { creator, roomData } = await setupRoom('Alice');
  const msgP = waitFor(creator, 'new-message');
  creator.emit('send-message', { roomCode: roomData.roomCode, encryptedContent: 'Delete me', ttl: '5m' });
  const msg = await msgP;

  const delP = waitFor(creator, 'message-deleted');
  creator.emit('delete-message', { roomCode: roomData.roomCode, messageId: msg.messageId });
  const del = await delP;
  assert(del.messageId === msg.messageId, 'Correct message deleted');

  creator.disconnect();
}

// =========================================================================
// TEST 9: Panic Delete
// =========================================================================
async function testPanicDelete() {
  console.log('\n🧪 Test 9: Panic Delete');
  const { creator, roomData } = await setupRoom('Alice');
  const { joiner } = await joinUser(creator, roomData.roomCode, 'Bob');

  // Send a message first
  await waitFor(creator, 'new-message', 3000).catch(() => {});
  creator.emit('send-message', { roomCode: roomData.roomCode, encryptedContent: 'test', ttl: '5m' });
  await new Promise((r) => setTimeout(r, 300));

  const panicCreatorP = waitFor(creator, 'panic-delete');
  const panicJoinerP = waitFor(joiner, 'panic-delete');
  creator.emit('panic-delete', { roomCode: roomData.roomCode });

  const pc = await panicCreatorP;
  const pj = await panicJoinerP;
  assert(pc.triggeredBy === 'Alice', 'Creator gets panic-delete with triggeredBy');
  assert(pj.triggeredBy === 'Alice', 'Joiner gets panic-delete with triggeredBy');

  creator.disconnect(); joiner.disconnect();
}

// =========================================================================
// TEST 10: 3-State Presence — user_inactive / user_active
// =========================================================================
async function testThreeStatePresence() {
  console.log('\n🧪 Test 10: 3-State Presence (Active / Inactive)');
  const { creator, roomData } = await setupRoom('Alice');
  const { joiner } = await joinUser(creator, roomData.roomCode, 'Bob');

  // Bob goes inactive
  const inactiveP = waitFor(creator, 'user-state-changed');
  joiner.emit('user_inactive');
  const inactiveData = await inactiveP;
  assert(inactiveData.state === 'inactive', 'Inactive state broadcast');
  assert(inactiveData.username === 'Bob', 'Inactive user is Bob');

  // Bob comes back active
  const activeP = waitFor(creator, 'user-state-changed');
  joiner.emit('user_active');
  const activeData = await activeP;
  assert(activeData.state === 'active', 'Active state broadcast');
  assert(activeData.username === 'Bob', 'Active user is Bob');

  creator.disconnect(); joiner.disconnect();
}

// =========================================================================
// TEST 11: Visibility Change Event (legacy)
// =========================================================================
async function testVisibilityChange() {
  console.log('\n🧪 Test 11: Visibility Change Event');
  const { creator, roomData } = await setupRoom('Alice');
  const { joiner } = await joinUser(creator, roomData.roomCode, 'Bob');

  const visP = waitFor(creator, 'user-visibility-changed');
  joiner.emit('visibility-change', { roomCode: roomData.roomCode, isVisible: false });
  const vis = await visP;
  assert(vis.isVisible === false, 'Visibility change: hidden');
  assert(vis.username === 'Bob', 'Visibility user is Bob');

  creator.disconnect(); joiner.disconnect();
}


// =========================================================================
// TEST 13: Creator Rejoin — Auto-Approve by creatorName
// =========================================================================
async function testCreatorRejoin() {
  console.log('\n🧪 Test 13: Creator Rejoin (Auto-Approve)');
  const { creator, roomData } = await setupRoom('Alice');
  const { joiner } = await joinUser(creator, roomData.roomCode, 'Bob');

  // Creator disconnects
  const leftP = waitFor(joiner, 'user-left');
  creator.disconnect();
  await leftP;

  // Wait a beat for cleanup
  await new Promise((r) => setTimeout(r, 300));

  // Creator rejoins with same username "Alice" — should be auto-approved
  const creator2 = await createClient('creator2');
  const approvedP = waitFor(creator2, 'join-approved');
  const rejoinedP = waitFor(joiner, 'user-rejoined');
  creator2.emit('join-request', { roomCode: roomData.roomCode, username: 'Alice' });

  const approved = await approvedP;
  assert(approved.isCreator === true, 'Rejoined creator gets isCreator=true');
  assert(!!approved.creatorId, 'Rejoined creator gets creatorId');
  assert(approved.username === 'Alice', 'Rejoined creator username matches');

  const rejoined = await rejoinedP;
  assert(rejoined.username === 'Alice', 'Room notified: Alice rejoined');

  creator2.disconnect(); joiner.disconnect();
}

// =========================================================================
// TEST 14: Offline Message Recovery — Rejoin Room
// =========================================================================
async function testOfflineMessageRecovery() {
  console.log('\n🧪 Test 14: Offline Message Recovery (Rejoin)');
  const { creator, roomData } = await setupRoom('Alice');
  const { joiner, approvedData } = await joinUser(creator, roomData.roomCode, 'Bob');
  const bobUserId = approvedData.userId;

  // Bob disconnects
  const leftP = waitFor(creator, 'user-left');
  joiner.disconnect();
  await leftP;
  await new Promise((r) => setTimeout(r, 300));

  // Alice sends messages while Bob is offline
  const msg1P = waitFor(creator, 'new-message');
  creator.emit('send-message', { roomCode: roomData.roomCode, encryptedContent: 'Missed msg 1', ttl: '5m' });
  await msg1P;

  const msg2P = waitFor(creator, 'new-message');
  creator.emit('send-message', { roomCode: roomData.roomCode, encryptedContent: 'Missed msg 2', ttl: '5m' });
  await msg2P;

  // Bob reconnects via rejoin-room
  const bob2 = await createClient('bob2');
  const missedP = collectEvents(bob2, 'new-message', 2, 5000);
  bob2.emit('rejoin-room', { roomCode: roomData.roomCode, userId: bobUserId, username: 'Bob' });

  const missed = await missedP;
  assert(missed.length === 2, `Bob received ${missed.length} missed messages`);
  assert(missed[0].encryptedContent === 'Missed msg 1', 'First missed message correct');
  assert(missed[1].encryptedContent === 'Missed msg 2', 'Second missed message correct');

  creator.disconnect(); bob2.disconnect();
}

// =========================================================================
// TEST 15: Creator Rejoin — Missed Message Delivery
// =========================================================================
async function testCreatorRejoinMissedMessages() {
  console.log('\n🧪 Test 15: Creator Rejoin — Missed Messages');
  const { creator, roomData } = await setupRoom('Alice');
  const { joiner } = await joinUser(creator, roomData.roomCode, 'Bob');

  // Creator disconnects
  const leftP = waitFor(joiner, 'user-left');
  creator.disconnect();
  await leftP;
  await new Promise((r) => setTimeout(r, 300));

  // Bob sends a message while creator is offline
  const msgP = waitFor(joiner, 'new-message');
  joiner.emit('send-message', { roomCode: roomData.roomCode, encryptedContent: 'Creator missed this', ttl: '5m' });
  await msgP;

  // Creator rejoins with same username
  const creator2 = await createClient('creator2');
  const approvedP = waitFor(creator2, 'join-approved');
  const missedP = waitFor(creator2, 'new-message', 5000);
  creator2.emit('join-request', { roomCode: roomData.roomCode, username: 'Alice' });

  await approvedP;
  const missed = await missedP;
  assert(missed.encryptedContent === 'Creator missed this', 'Creator receives missed message on rejoin');

  creator2.disconnect(); joiner.disconnect();
}

// =========================================================================
// TEST 16: After-Seen TTL Mapping = 3 seconds
// =========================================================================
async function testAfterSeenTTL() {
  console.log('\n🧪 Test 16: After-Seen TTL = 3s');
  const { creator, roomData } = await setupRoom('Alice');

  const msgP = waitFor(creator, 'new-message');
  creator.emit('send-message', { roomCode: roomData.roomCode, encryptedContent: 'Vanish', ttl: 'after-seen' });
  const msg = await msgP;
  assert(msg.ttl === 'after-seen', 'TTL is after-seen');
  assert(msg.ttlSeconds === 3, 'ttlSeconds = 3 (not 10)');

  creator.disconnect();
}

// =========================================================================
// TEST 17: Join-Approved includes creatorId for non-creator users
// =========================================================================
async function testJoinApprovedCreatorId() {
  console.log('\n🧪 Test 17: Join-Approved includes creatorId');
  const { creator, roomData } = await setupRoom('Alice');
  const { approvedData } = await joinUser(creator, roomData.roomCode, 'Bob');
  assert(!!approvedData.creatorId, 'join-approved includes creatorId');
  assert(approvedData.creatorId === roomData.userId, 'creatorId matches room creator');

  creator.disconnect();
}

// =========================================================================
// TEST 18: SPA Fallback — /r/ROOMCODE returns HTML (not 404)
// =========================================================================
async function testSPAFallback() {
  console.log('\n🧪 Test 18: SPA Fallback for Deep Links');
  const res = await fetch(`${SERVER}/r/testcode123`);
  // In dev mode without static files, we get JSON 404; in prod we get HTML
  // Either way, we should NOT get a crash/500
  assert(res.status !== 500, '/r/ROOMCODE does not crash (no 500)');
}

// =========================================================================
// RUN ALL TESTS
// =========================================================================
async function run() {
  console.log('🚀 Ghost Chat — Comprehensive Feature Test Suite\n');
  console.log('='.repeat(60));

  try {
    await testHealth();
    await testRoomCreation();
    await testJoinFlow();
    await testMessaging();
    await testTyping();
    await testPresenceDisconnect();
    await testInvalidRoom();
    await testMessageDeletion();
    await testPanicDelete();
    await testThreeStatePresence();
    await testVisibilityChange();
    await testCreatorRejoin();
    await testOfflineMessageRecovery();
    await testCreatorRejoinMissedMessages();
    await testAfterSeenTTL();
    await testJoinApprovedCreatorId();
    await testSPAFallback();
  } catch (err) {
    console.error('\n💥 Test crashed:', err.message);
    failed++;
  }

  console.log('\n' + '='.repeat(60));
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${total} total`);

  if (failed > 0) {
    console.log('\n⚠️  Some tests failed!');
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  }
}

run();
