// Test: Presence states, explicit leave vs disconnect, visibility
const { cleanup, waitFor, wait, assert, results, setup2, client } = require('./helpers');

async function run() {
  console.log('🧪 Test Suite: Presence & Leave\n');

  // --- 3-State Presence ---
  console.log('📌 Active / Inactive / Offline');
  const s = await setup2('Alice', 'Bob');

  const iP = waitFor(s.creator.client, 'user-state-changed');
  s.joiner.client.emit('user_inactive');
  const i = await iP;
  assert(i.state === 'inactive', 'Inactive broadcast');
  assert(i.username === 'Bob', 'Inactive = Bob');

  const aP = waitFor(s.creator.client, 'user-state-changed');
  s.joiner.client.emit('user_active');
  assert((await aP).state === 'active', 'Active broadcast');

  const lP = waitFor(s.creator.client, 'user-left');
  const oP = waitFor(s.creator.client, 'user-state-changed');
  s.joiner.client.disconnect();
  assert((await lP).username === 'Bob', 'user-left on disconnect');
  assert((await oP).state === 'offline', 'Offline broadcast');
  cleanup(); await wait(800);

  // --- Explicit Leave = "left the room" ---
  console.log('\n📌 Explicit Leave (user-left-room)');
  const s2 = await setup2('Alice', 'Bob');
  const lrP = waitFor(s2.creator.client, 'user-left-room');
  s2.joiner.client.emit('leave-room');
  const lr = await lrP;
  assert(lr.username === 'Bob', 'user-left-room event');
  assert(lr.userId === s2.joiner.userId, 'Correct userId');
  cleanup(); await wait(800);

  // --- Network Disconnect = "disconnected" (user-left) ---
  console.log('\n📌 Network Disconnect (user-left)');
  const s3 = await setup2('Alice', 'Charlie');
  const nlP = waitFor(s3.creator.client, 'user-left');
  s3.joiner.client.disconnect();
  assert((await nlP).username === 'Charlie', 'user-left on network loss');
  cleanup(); await wait(800);

  // --- Visibility ---
  console.log('\n📌 Visibility Change');
  const s4 = await setup2('Alice', 'Bob');
  const vP = waitFor(s4.creator.client, 'user-visibility-changed');
  s4.joiner.client.emit('visibility-change', { roomCode: s4.creator.roomCode, isVisible: false });
  const v = await vP;
  assert(v.isVisible === false, 'Hidden');
  assert(v.username === 'Bob', 'Vis user = Bob');
  cleanup();

  process.exit(results());
}

run().catch(e => { console.error('💥', e.message); cleanup(); process.exit(1); });
