// =============================================================================
// debug-message-buffer.js — Debug message buffering
// =============================================================================

const { io } = require('socket.io-client');
const BASE = 'http://localhost:3001';

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

async function debugBuffer() {
  console.log('🔍 Debugging Message Buffer\n');
  
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
  
  // Alice sends messages
  console.log('\n📤 Alice sending 3 messages...');
  for (let i = 0; i < 3; i++) {
    creator.emit('new-message', { 
      roomCode, 
      encryptedContent: `Test message ${i+1}`, 
      ttl: 300 
    });
    await wait(100);
  }
  
  // Wait a bit more
  await wait(500);
  
  // Bob reconnects
  console.log('\n🔄 Bob reconnecting...');
  const bob2 = createClient();
  await waitForEvent(bob2, 'connect');
  await wait(50);
  
  // Bob rejoins
  bob2.emit('rejoin-room', { roomCode, userId: joinResp.userId, username: 'Bob' });
  
  // Listen for messages
  let messageCount = 0;
  bob2.on('new-message', (msg) => {
    messageCount++;
    console.log(`📨 Received message ${messageCount}: ${msg.encryptedContent}`);
  });
  
  // Wait for messages
  await wait(2000);
  
  console.log(`\n📊 Total messages received: ${messageCount}/3`);
  
  creator.disconnect();
  bob2.disconnect();
}

debugBuffer().catch(console.error);
