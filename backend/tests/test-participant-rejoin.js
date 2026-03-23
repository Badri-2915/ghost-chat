// Test: Participant rejoin — no duplicate users in list
const { cleanup, waitFor, wait, assert, results, createRoom, setup2, client } = require('./helpers');

async function run() {
  console.log('🧪 Test Suite: Participant Rejoin (No Duplicates)\n');

  // --- 1. Participant reconnect (same username) ---
  console.log('📌 Participant Reconnect (same username)');
  const s1 = await setup2('Alice', 'Bob');
  const leftP = waitFor(s1.creator.client, 'user-left');
  s1.joiner.client.disconnect();
  await leftP;
  await wait(300);

  const bob2 = client();
  await waitFor(bob2, 'connect');
  const usersP1 = waitFor(s1.creator.client, 'users-updated');
  bob2.emit('rejoin-room', { roomCode: s1.creator.roomCode, userId: s1.joiner.userId, username: 'Bob' });
  const u1 = await usersP1;
  const userList1 = Object.values(u1.users).map(u => u.username);
  const bobCount1 = userList1.filter(n => n === 'Bob').length;
  assert(bobCount1 === 1, `Only 1 Bob (got ${bobCount1}): [${userList1}]`);
  assert(userList1.length === 2, `2 users total (got ${userList1.length})`);
  cleanup(); await wait(1500);

  // --- 2. Participant reconnect (different username) ---
  console.log('\n📌 Participant Reconnect (different username)');
  const s2 = await setup2('Alice', 'UserA');
  const leftP2 = waitFor(s2.creator.client, 'user-left');
  s2.joiner.client.disconnect();
  await leftP2;
  await wait(300);

  const ua2 = client();
  await waitFor(ua2, 'connect');
  // Set up listeners BEFORE emit
  const rejoinP2 = waitFor(s2.creator.client, 'user-rejoined');
  const usersP2 = waitFor(s2.creator.client, 'users-updated');
  ua2.emit('rejoin-room', { roomCode: s2.creator.roomCode, userId: s2.joiner.userId, username: 'UserA_new' });
  await rejoinP2;
  const u2 = await usersP2;
  const userList2 = Object.values(u2.users).map(u => u.username);
  assert(!userList2.includes('UserA'), `Old username "UserA" removed`);
  assert(userList2.includes('UserA_new'), `New username "UserA_new" present`);
  assert(userList2.length === 2, `2 users total (got ${userList2.length}): [${userList2}]`);
  cleanup(); await wait(1500);

  // --- 3. Participant multiple rejoins ---
  console.log('\n📌 Participant Multiple Rejoins');
  const s3 = await setup2('Alice', 'Bob');
  // First rejoin
  const l3a = waitFor(s3.creator.client, 'user-left');
  s3.joiner.client.disconnect();
  await l3a;
  await wait(300);

  const bob3a = client();
  await waitFor(bob3a, 'connect');
  const rj3a = waitFor(s3.creator.client, 'user-rejoined');
  bob3a.emit('rejoin-room', { roomCode: s3.creator.roomCode, userId: s3.joiner.userId, username: 'Bob_v2' });
  await rj3a;
  await wait(100);

  // Second rejoin
  const l3b = waitFor(s3.creator.client, 'user-left');
  bob3a.disconnect();
  await l3b;
  await wait(300);

  const bob3b = client();
  await waitFor(bob3b, 'connect');
  const rj3b = waitFor(s3.creator.client, 'user-rejoined');
  const usersP3 = waitFor(s3.creator.client, 'users-updated');
  bob3b.emit('rejoin-room', { roomCode: s3.creator.roomCode, userId: s3.joiner.userId, username: 'Bob_v3' });
  await rj3b;
  const u3 = await usersP3;
  const userList3 = Object.values(u3.users).map(u => u.username);
  assert(!userList3.includes('Bob'), `"Bob" removed`);
  assert(!userList3.includes('Bob_v2'), `"Bob_v2" removed`);
  assert(userList3.includes('Bob_v3'), `"Bob_v3" present`);
  assert(userList3.length === 2, `2 users total (got ${userList3.length}): [${userList3}]`);
  cleanup(); await wait(1500);

  // --- 4. Participant page refresh (same userId, same username) ---
  console.log('\n📌 Participant Page Refresh (same userId + username)');
  const s4 = await setup2('Alice', 'Bob');
  const l4 = waitFor(s4.creator.client, 'user-left');
  s4.joiner.client.disconnect();
  await l4;
  await wait(300);

  const bob4 = client();
  await waitFor(bob4, 'connect');
  const usersP4 = waitFor(s4.creator.client, 'users-updated');
  bob4.emit('rejoin-room', { roomCode: s4.creator.roomCode, userId: s4.joiner.userId, username: 'Bob' });
  const u4 = await usersP4;
  const userList4 = Object.values(u4.users).map(u => u.username);
  assert(userList4.filter(n => n === 'Bob').length === 1, `Only 1 Bob after refresh`);

  // Rejoin again immediately (simulate double-connect)
  const l4b = waitFor(s4.creator.client, 'user-left');
  bob4.disconnect();
  await l4b;
  await wait(300);

  const bob4b = client();
  await waitFor(bob4b, 'connect');
  const usersP4b = waitFor(s4.creator.client, 'users-updated');
  bob4b.emit('rejoin-room', { roomCode: s4.creator.roomCode, userId: s4.joiner.userId, username: 'Bob' });
  const u4b = await usersP4b;
  const userList4b = Object.values(u4b.users).map(u => u.username);
  assert(userList4b.filter(n => n === 'Bob').length === 1, `Still only 1 Bob after second refresh`);
  assert(userList4b.length === 2, `2 users total (got ${userList4b.length})`);
  cleanup();

  process.exit(results());
}

run().catch(e => { console.error('💥', e.message); cleanup(); process.exit(1); });
