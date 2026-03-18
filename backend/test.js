// Comprehensive feature test for Ghost Chat
const { io } = require('socket.io-client');

const SERVER = 'http://localhost:3001';
let passed = 0;
let failed = 0;

function assert(condition, name) {
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
    client.on('connect', () => {
      // Small delay to ensure server-side socket setup is complete
      setTimeout(() => resolve(client), 100);
    });
    client.on('connect_error', (err) => reject(new Error(`${name} connect failed: ${err.message}`)));
  });
}

function waitFor(client, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event} on ${client._name}`)), timeout);
    client.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function testHealthEndpoint() {
  console.log('\n🧪 Test: Health Endpoint');
  const res = await fetch(`${SERVER}/api/health`);
  const data = await res.json();
  assert(res.status === 200, 'GET /api/health returns 200');
  assert(data.status === 'ok', 'Status is "ok"');
  assert(typeof data.connections === 'number', 'Has connections count');
  assert(typeof data.uptime === 'number', 'Has uptime');
}

async function testRoomCreation() {
  console.log('\n🧪 Test: Room Creation');
  const creator = await createClient('creator');

  const roomCreatedPromise = waitFor(creator, 'room-created');
  const usersPromise = waitFor(creator, 'users-updated');

  creator.emit('create-room', { username: 'Alice' });

  const roomData = await roomCreatedPromise;
  assert(!!roomData.roomCode, `Room code generated: ${roomData.roomCode}`);
  assert(roomData.roomCode.length === 8, 'Room code is 8 chars');
  assert(!!roomData.userId, 'User ID assigned');
  assert(roomData.username === 'Alice', 'Username matches');
  assert(roomData.isCreator === true, 'Marked as creator');

  const users = await usersPromise;
  const userIds = Object.keys(users);
  assert(userIds.length === 1, 'One user in room');
  assert(users[roomData.userId].username === 'Alice', 'User name in presence list');

  creator.disconnect();
  return roomData.roomCode;
}

async function testJoinRequestFlow() {
  console.log('\n🧪 Test: Join Request / Approve / Reject Flow');

  // Creator creates room
  const creator = await createClient('creator');
  const roomPromise = waitFor(creator, 'room-created');
  creator.emit('create-room', { username: 'Alice' });
  const roomData = await roomPromise;
  await waitFor(creator, 'users-updated');

  // Joiner sends join request
  const joiner = await createClient('joiner');
  const joinRequestedPromise = waitFor(joiner, 'join-requested');
  const joinRequestsPromise = waitFor(creator, 'join-requests-updated');

  joiner.emit('join-request', { roomCode: roomData.roomCode, username: 'Bob' });

  const joinReqData = await joinRequestedPromise;
  assert(joinReqData.roomCode === roomData.roomCode, 'Joiner got room code back');
  assert(joinReqData.username === 'Bob', 'Joiner username matches');

  const requests = await joinRequestsPromise;
  const reqIds = Object.keys(requests);
  assert(reqIds.length === 1, 'Creator sees 1 join request');
  assert(requests[reqIds[0]].username === 'Bob', 'Request shows Bob');

  // Creator approves
  const joinApprovedPromise = waitFor(joiner, 'join-approved');
  const usersUpdatedPromise = waitFor(creator, 'users-updated');

  creator.emit('approve-join', { roomCode: roomData.roomCode, userId: reqIds[0] });

  await joinApprovedPromise;
  assert(true, 'Joiner received join-approved');

  const updatedUsers = await usersUpdatedPromise;
  assert(Object.keys(updatedUsers).length === 2, 'Two users in room after approval');

  // Test rejection with a third user
  const joiner2 = await createClient('joiner2');
  const joinReq2Promise = waitFor(joiner2, 'join-requested');
  const joinReqs2Promise = waitFor(creator, 'join-requests-updated');

  joiner2.emit('join-request', { roomCode: roomData.roomCode, username: 'Charlie' });

  await joinReq2Promise;
  const reqs2 = await joinReqs2Promise;
  const req2Ids = Object.keys(reqs2);

  const rejectedPromise = waitFor(joiner2, 'join-rejected');
  creator.emit('reject-join', { roomCode: roomData.roomCode, userId: req2Ids[0] });
  await rejectedPromise;
  assert(true, 'Rejected user received join-rejected');

  creator.disconnect();
  joiner.disconnect();
  joiner2.disconnect();

  return roomData.roomCode;
}

async function testMessaging() {
  console.log('\n🧪 Test: Real-Time Messaging');

  // Setup: create room with 2 users
  const creator = await createClient('creator');
  const roomPromise = waitFor(creator, 'room-created');
  creator.emit('create-room', { username: 'Alice' });
  const roomData = await roomPromise;
  await waitFor(creator, 'users-updated');

  const joiner = await createClient('joiner');
  const joinReqPromise = waitFor(joiner, 'join-requested');
  const joinReqsPromise = waitFor(creator, 'join-requests-updated');

  joiner.emit('join-request', { roomCode: roomData.roomCode, username: 'Bob' });
  await joinReqPromise;
  const reqs = await joinReqsPromise;
  const reqId = Object.keys(reqs)[0];

  const approvedPromise = waitFor(joiner, 'join-approved');
  creator.emit('approve-join', { roomCode: roomData.roomCode, userId: reqId });
  await approvedPromise;
  await waitFor(creator, 'users-updated');

  // Send message from creator
  const creatorMsgPromise = waitFor(creator, 'new-message');
  const joinerMsgPromise = waitFor(joiner, 'new-message');

  creator.emit('send-message', {
    roomCode: roomData.roomCode,
    encryptedContent: 'Hello Bob!',
    ttl: '5m',
  });

  const creatorMsg = await creatorMsgPromise;
  const joinerMsg = await joinerMsgPromise;

  assert(!!creatorMsg.messageId, 'Message has UUID');
  assert(creatorMsg.senderName === 'Alice', 'Sender name correct');
  assert(creatorMsg.encryptedContent === 'Hello Bob!', 'Content delivered to sender');
  assert(joinerMsg.encryptedContent === 'Hello Bob!', 'Content delivered to receiver');
  assert(creatorMsg.ttl === '5m', 'TTL preserved');
  assert(typeof creatorMsg.timestamp === 'number', 'Timestamp present');
  assert(creatorMsg.status === 'sent', 'Initial status is sent');

  // Test message delivered receipt
  const statusPromise = waitFor(creator, 'message-status-update');
  joiner.emit('message-delivered', {
    roomCode: roomData.roomCode,
    messageId: creatorMsg.messageId,
  });

  const statusUpdate = await statusPromise;
  assert(statusUpdate.status === 'delivered', 'Delivered status received');
  assert(statusUpdate.messageId === creatorMsg.messageId, 'Correct message ID for status');

  // Test message read receipt
  const readPromise = waitFor(creator, 'message-status-update');
  joiner.emit('message-read', {
    roomCode: roomData.roomCode,
    messageId: creatorMsg.messageId,
  });

  const readUpdate = await readPromise;
  assert(readUpdate.status === 'read', 'Read status received');

  creator.disconnect();
  joiner.disconnect();
}

async function testTypingIndicator() {
  console.log('\n🧪 Test: Typing Indicator');

  const creator = await createClient('creator');
  const roomPromise = waitFor(creator, 'room-created');
  creator.emit('create-room', { username: 'Alice' });
  const roomData = await roomPromise;
  await waitFor(creator, 'users-updated');

  const joiner = await createClient('joiner');
  const joinReqPromise = waitFor(joiner, 'join-requested');
  const joinReqsPromise = waitFor(creator, 'join-requests-updated');
  joiner.emit('join-request', { roomCode: roomData.roomCode, username: 'Bob' });
  await joinReqPromise;
  const reqs = await joinReqsPromise;

  const approvedPromise = waitFor(joiner, 'join-approved');
  creator.emit('approve-join', { roomCode: roomData.roomCode, userId: Object.keys(reqs)[0] });
  await approvedPromise;
  await waitFor(creator, 'users-updated');

  // Bob starts typing
  const typingPromise = waitFor(creator, 'user-typing');
  joiner.emit('typing-start', { roomCode: roomData.roomCode });
  const typingData = await typingPromise;
  assert(typingData.username === 'Bob', 'Typing indicator shows correct user');

  // Bob stops typing
  const stopTypingPromise = waitFor(creator, 'user-stopped-typing');
  joiner.emit('typing-stop', { roomCode: roomData.roomCode });
  const stopData = await stopTypingPromise;
  assert(!!stopData.userId, 'Stop typing event received');

  creator.disconnect();
  joiner.disconnect();
}

async function testPresenceOnDisconnect() {
  console.log('\n🧪 Test: Presence (User Leave)');

  const creator = await createClient('creator');
  const roomPromise = waitFor(creator, 'room-created');
  creator.emit('create-room', { username: 'Alice' });
  const roomData = await roomPromise;
  await waitFor(creator, 'users-updated');

  const joiner = await createClient('joiner');
  const joinReqPromise = waitFor(joiner, 'join-requested');
  const joinReqsPromise = waitFor(creator, 'join-requests-updated');
  joiner.emit('join-request', { roomCode: roomData.roomCode, username: 'Bob' });
  await joinReqPromise;
  const reqs = await joinReqsPromise;

  const approvedPromise = waitFor(joiner, 'join-approved');
  creator.emit('approve-join', { roomCode: roomData.roomCode, userId: Object.keys(reqs)[0] });
  await approvedPromise;
  await waitFor(creator, 'users-updated');

  // Bob disconnects
  const userLeftPromise = waitFor(creator, 'user-left');
  const usersUpdatedPromise = waitFor(creator, 'users-updated');
  joiner.disconnect();

  const leftData = await userLeftPromise;
  assert(leftData.username === 'Bob', 'User left event shows Bob');

  const updatedUsers = await usersUpdatedPromise;
  assert(Object.keys(updatedUsers).length === 1, 'Only 1 user remains after disconnect');

  creator.disconnect();
}

async function testInvalidRoom() {
  console.log('\n🧪 Test: Invalid Room Code');

  const client = await createClient('tester');
  const errorPromise = waitFor(client, 'error-message');
  client.emit('join-request', { roomCode: 'INVALID99', username: 'Eve' });

  const err = await errorPromise;
  assert(err.message === 'Room not found', 'Error for invalid room code');

  client.disconnect();
}

async function testMessageDeletion() {
  console.log('\n🧪 Test: Message Deletion');

  const creator = await createClient('creator');
  const roomPromise = waitFor(creator, 'room-created');
  creator.emit('create-room', { username: 'Alice' });
  const roomData = await roomPromise;
  await waitFor(creator, 'users-updated');

  // Send message
  const msgPromise = waitFor(creator, 'new-message');
  creator.emit('send-message', {
    roomCode: roomData.roomCode,
    encryptedContent: 'Delete me',
    ttl: '5m',
  });
  const msg = await msgPromise;

  // Delete message
  const deletePromise = waitFor(creator, 'message-deleted');
  creator.emit('delete-message', {
    roomCode: roomData.roomCode,
    messageId: msg.messageId,
  });
  const deleted = await deletePromise;
  assert(deleted.messageId === msg.messageId, 'Correct message deleted');

  creator.disconnect();
}

async function run() {
  console.log('🚀 Ghost Chat — Feature Test Suite\n');
  console.log('=' .repeat(50));

  try {
    await testHealthEndpoint();
    await testRoomCreation();
    await testJoinRequestFlow();
    await testMessaging();
    await testTypingIndicator();
    await testPresenceOnDisconnect();
    await testInvalidRoom();
    await testMessageDeletion();
  } catch (err) {
    console.error('\n💥 Test crashed:', err.message);
    failed++;
  }

  console.log('\n' + '='.repeat(50));
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);

  if (failed > 0) {
    console.log('\n⚠️  Some tests failed!');
    process.exit(1);
  } else {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  }
}

run();
