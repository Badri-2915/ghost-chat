// =============================================================================
// test-simple-buffer.js — Simple test for message buffering
// =============================================================================

const { io } = require('socket.io-client');
const BASE = 'http://localhost:3001';

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

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testSimpleBuffer() {
  console.log('🧪 Simple Message Buffer Test\n');
  
  const creator = createClient();
  const joiner = createClient();
  
  await waitForEvent(creator, 'connect');
  await waitForEvent(joiner, 'connect');
  
  // Create room
  creator.emit('create-room', { username: 'Alice' });
  const createResp = await waitForEvent(creator, 'room-created');
  const roomCode = createResp.roomCode;
  console.log(`✅ Room created: ${roomCode}`);
  
  // Joiner joins
  joiner.emit('join-request', { roomCode, username: 'Bob' });
  const joinReq = await waitForEvent(creator, 'join-requests-updated');
  const joinerId = Object.keys(joinReq)[0];
  creator.emit('approve-join', { roomCode, userId: joinerId });
  const joinResp = await waitForEvent(joiner, 'join-approved');
  console.log(`✅ Bob joined with userId: ${joinResp.userId}`);
  
  // Wait a bit
  await wait(500);
  
  // Bob disconnects
  console.log('\n📴 Bob disconnecting...');
  joiner.disconnect();
  
  // Wait for the 10-second grace period to start
  await wait(200);
  
  // Alice sends a message
  console.log('\n📤 Alice sending message...');
  creator.emit('send-message', { 
    roomCode, 
    encryptedContent: 'Test message while Bob offline', 
    ttl: 300 
  });
  
  // Wait for message to be processed
  await wait(500);
  
  // Bob reconnects immediately (before 10s removal)
  console.log('\n🔄 Bob reconnecting (before 10s removal)...');
  const bob2 = createClient();
  await waitForEvent(bob2, 'connect');
  await wait(50);
  
  // Bob rejoins
  bob2.emit('rejoin-room', { roomCode, userId: joinResp.userId, username: 'Bob' });
  
  // Listen for messages
  let messageCount = 0;
  bob2.on('new-message', (msg) => {
    messageCount++;
    console.log(`📨 Received message: ${msg.encryptedContent}`);
  });
  
  // Wait for messages
  await wait(2000);
  
  console.log(`\n📊 Total messages received: ${messageCount}/1`);
  
  creator.disconnect();
  bob2.disconnect();
  
  if (messageCount >= 1) {
    console.log('✅ Message buffering works!');
  } else {
    console.log('❌ Message buffering failed!');
  }
}

testSimpleBuffer().catch(console.error);
