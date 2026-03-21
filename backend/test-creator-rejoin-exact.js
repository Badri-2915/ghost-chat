// =============================================================================
// test-creator-rejoin-exact.js — Simulates the EXACT user scenario:
// 1. Creator creates room
// 2. Bob joins
// 3. Creator clicks "Leave Room" (disconnects socket, loses state)
// 4. Creator opens app again, enters room code, clicks Join
// 5. Creator should be auto-approved via creatorToken
// =============================================================================

const { io } = require('socket.io-client');
const BASE = 'http://localhost:3001';

function client() {
  return io(BASE, { timeout: 5000, reconnection: false, forceNew: true });
}

function waitFor(c, ev, ms = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout: ${ev}`)), ms);
    c.once(ev, (d) => { clearTimeout(t); resolve(d); });
  });
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

async function run() {
  console.log('\n🧪 EXACT Creator Rejoin Scenario Test\n');

  // === STEP 1: Creator creates room ===
  console.log('--- Step 1: Creator creates room ---');
  const alice = client();
  await waitFor(alice, 'connect');
  alice.emit('create-room', { username: 'Alice' });
  const room = await waitFor(alice, 'room-created');
  const creatorToken = room.creatorToken;
  console.log(`  Room: ${room.roomCode}, Token: ${creatorToken}`);
  assert(!!creatorToken, 'Creator gets creatorToken');

  // === STEP 2: Bob joins ===
  console.log('\n--- Step 2: Bob joins ---');
  const bob = client();
  await waitFor(bob, 'connect');
  bob.emit('join-request', { roomCode: room.roomCode, username: 'Bob' });
  const req = await waitFor(alice, 'join-requests-updated');
  alice.emit('approve-join', { roomCode: room.roomCode, userId: Object.keys(req)[0] });
  await waitFor(bob, 'join-approved');
  console.log('  Bob approved');

  await wait(500);

  // === STEP 3: Creator clicks "Leave Room" ===
  // This disconnects the socket and clears all React state
  // But localStorage still has the creatorToken
  console.log('\n--- Step 3: Creator clicks Leave Room ---');
  alice.disconnect();
  await wait(1000);

  // Verify Bob sees Alice left
  // (Bob should have gotten user-left event)

  // === STEP 4: Creator opens app again, enters room code, clicks Join ===
  // This is a FRESH socket connection with NO session state
  // But the creatorToken was stored in localStorage per room
  console.log('\n--- Step 4: Creator rejoins via join-request WITH creatorToken ---');
  const alice2 = client();
  await waitFor(alice2, 'connect');

  // Simulate: frontend joinRoom() looks up localStorage for creatorToken
  alice2.emit('join-request', {
    roomCode: room.roomCode,
    username: 'Alice',
    creatorToken: creatorToken  // This comes from localStorage
  });

  // Should get join-approved with isCreator: true
  let joinResult;
  try {
    joinResult = await waitFor(alice2, 'join-approved', 5000);
  } catch (e) {
    // Maybe got error instead
    joinResult = null;
  }

  assert(joinResult !== null, 'Creator got join-approved (not error)');
  assert(joinResult?.isCreator === true, 'Creator has isCreator: true');
  assert(joinResult?.creatorToken === creatorToken, 'CreatorToken preserved');
  console.log(`  Result: ${JSON.stringify(joinResult)}`);

  // === STEP 5: Verify Bob sees creator rejoin ===
  await wait(500);

  // === STEP 6: Now test WITHOUT creatorToken (should fail) ===
  console.log('\n--- Step 5: Non-creator tries join without token (should be blocked) ---');
  alice2.disconnect();
  await wait(1000);

  const charlie = client();
  await waitFor(charlie, 'connect');
  charlie.emit('join-request', {
    roomCode: room.roomCode,
    username: 'Charlie'
    // No creatorToken
  });

  let errorMsg;
  try {
    errorMsg = await waitFor(charlie, 'error-message', 5000);
  } catch (e) {
    errorMsg = null;
  }
  assert(errorMsg?.message?.includes('not available'), 'Non-creator blocked when creator absent');

  // === STEP 7: Test rejoin-room path (socket reconnect, not fresh join) ===
  console.log('\n--- Step 6: Creator reconnects via rejoin-room ---');
  const alice3 = client();
  await waitFor(alice3, 'connect');
  alice3.emit('create-room', { username: 'Alice' });
  const room2 = await waitFor(alice3, 'room-created');

  // Bob2 joins
  const bob2 = client();
  await waitFor(bob2, 'connect');
  bob2.emit('join-request', { roomCode: room2.roomCode, username: 'Bob2' });
  const req2 = await waitFor(alice3, 'join-requests-updated');
  alice3.emit('approve-join', { roomCode: room2.roomCode, userId: Object.keys(req2)[0] });
  await waitFor(bob2, 'join-approved');

  await wait(500);

  // Alice disconnects (network loss, not Leave button)
  const aliceUserId = room2.userId;
  alice3.disconnect();
  await wait(1000);

  // Alice reconnects with same userId via rejoin-room
  const alice4 = client();
  await waitFor(alice4, 'connect');
  alice4.emit('rejoin-room', {
    roomCode: room2.roomCode,
    userId: aliceUserId,
    username: 'Alice',
    creatorToken: room2.creatorToken
  });

  // Should get users-updated (not error)
  let usersUpdate;
  try {
    usersUpdate = await waitFor(alice4, 'users-updated', 5000);
  } catch (e) {
    usersUpdate = null;
  }
  assert(usersUpdate !== null, 'Creator rejoin-room succeeded');
  assert(usersUpdate?.creator === aliceUserId, 'Creator identity preserved after rejoin-room');

  // === STEP 8: Test /api/leave endpoint ===
  console.log('\n--- Step 7: Test /api/leave for instant disconnect ---');
  const http = require('http');
  const leavePayload = JSON.stringify({ roomCode: room2.roomCode, userId: aliceUserId });
  
  await new Promise((resolve) => {
    const req = http.request('http://localhost:3001/api/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': leavePayload.length }
    }, (res) => {
      assert(res.statusCode === 200, '/api/leave returns 200');
      resolve();
    });
    req.write(leavePayload);
    req.end();
  });

  await wait(500);

  // Cleanup
  bob.disconnect();
  bob2.disconnect();
  charlie.disconnect();
  alice2.disconnect();
  alice4.disconnect();
  await wait(200);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
  if (failed === 0) console.log('🎉 All tests passed!');
  else console.log('⚠️  Some tests failed!');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('CRASH:', err); process.exit(1); });
