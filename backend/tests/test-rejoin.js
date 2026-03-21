// Test: Creator rejoin, absence blocking, wrong token, session preserved, no duplicate rejoin
const { cleanup, waitFor, wait, assert, results, createRoom, setup2, client } = require('./helpers');

async function run() {
  console.log('🧪 Test Suite: Rejoin & Creator\n');

  // --- Creator Rejoin via join-request + creatorToken ---
  console.log('📌 Creator Rejoin (join-request + token)');
  const c1 = await createRoom('Alice');
  const bob = client();
  await waitFor(bob, 'connect');
  const rqP = waitFor(c1.client, 'join-requests-updated');
  bob.emit('join-request', { roomCode: c1.roomCode, username: 'Bob' });
  const rq = await rqP;
  c1.client.emit('approve-join', { roomCode: c1.roomCode, userId: Object.keys(rq)[0] });
  await waitFor(bob, 'join-approved');
  await wait(100);

  c1.client.emit('leave-room');
  await wait(500);

  const alice2 = client();
  await waitFor(alice2, 'connect');
  const rjP = waitFor(bob, 'user-rejoined');
  alice2.emit('join-request', { roomCode: c1.roomCode, username: 'Alice', creatorToken: c1.creatorToken });
  const ap = await waitFor(alice2, 'join-approved');
  const rj = await rjP;
  assert(ap.isCreator === true, 'Creator restored');
  assert(ap.creatorToken === c1.creatorToken, 'Token preserved');
  assert(rj.username === 'Alice', 'Bob sees rejoin');
  cleanup(); await wait(800);

  // --- Creator Rejoin via rejoin-room ---
  console.log('\n📌 Creator Rejoin (rejoin-room)');
  const s2 = await setup2('Alice', 'Bob');
  const lP = waitFor(s2.joiner.client, 'user-left');
  s2.creator.client.disconnect();
  await lP;
  await wait(300);

  const a3 = client();
  await waitFor(a3, 'connect');
  const rjP2 = waitFor(s2.joiner.client, 'user-rejoined');
  a3.emit('rejoin-room', { roomCode: s2.creator.roomCode, userId: s2.creator.userId, username: 'Alice', creatorToken: s2.creator.creatorToken });
  assert((await rjP2).username === 'Alice', 'Creator rejoined via rejoin-room');
  cleanup(); await wait(800);

  // --- Creator Absence Blocking ---
  console.log('\n📌 Creator Absence Blocking');
  const c3 = await createRoom('Alice');
  c3.client.disconnect();
  await wait(300);
  const b3 = client();
  await waitFor(b3, 'connect');
  const errP = waitFor(b3, 'error-message');
  b3.emit('join-request', { roomCode: c3.roomCode, username: 'Bob' });
  const err = await errP;
  assert(err.message.includes('not available'), 'Blocked when creator absent');
  cleanup(); await wait(800);

  // --- Wrong Token ---
  console.log('\n📌 Wrong CreatorToken');
  const s4 = await setup2('Alice', 'Bob');
  const imp = client();
  await waitFor(imp, 'connect');
  const rqsP = waitFor(s4.creator.client, 'join-requests-updated');
  imp.emit('join-request', { roomCode: s4.creator.roomCode, username: 'Fake', creatorToken: 'wrong-token-99999' });
  const rqs = await rqsP;
  assert(Object.keys(rqs).length > 0, 'Wrong token → normal join flow');
  cleanup(); await wait(800);

  // --- Session Preserved on Reconnect ---
  console.log('\n📌 Session Preserved');
  const s5 = await setup2('Alice', 'Bob');
  const l5 = waitFor(s5.creator.client, 'user-left');
  s5.joiner.client.disconnect();
  await l5; await wait(300);

  const b5 = client();
  await waitFor(b5, 'connect');
  const rj5 = waitFor(s5.creator.client, 'user-rejoined');
  b5.emit('rejoin-room', { roomCode: s5.creator.roomCode, userId: s5.joiner.userId, username: 'Bob' });
  const r5 = await rj5;
  assert(r5.username === 'Bob', 'Same identity');
  assert(r5.userId === s5.joiner.userId, 'Same userId');
  cleanup(); await wait(800);

  // --- No Duplicate Rejoin ---
  console.log('\n📌 No Duplicate Rejoin Notification');
  const s6 = await setup2('Alice', 'Bob');
  const l6 = waitFor(s6.creator.client, 'user-left');
  s6.joiner.client.disconnect();
  await l6; await wait(300);

  let count = 0;
  const rj6P = new Promise(res => {
    s6.creator.client.on('user-rejoined', d => { if (d.username === 'Bob') count++; res(); });
  });
  const b6 = client();
  await waitFor(b6, 'connect');
  b6.emit('rejoin-room', { roomCode: s6.creator.roomCode, userId: s6.joiner.userId, username: 'Bob' });
  await rj6P;
  await wait(500);
  assert(count === 1, `Only 1 rejoin (got ${count})`);
  cleanup();

  process.exit(results());
}

run().catch(e => { console.error('💥', e.message); cleanup(); process.exit(1); });
