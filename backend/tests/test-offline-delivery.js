// Test: THE CRITICAL ONE — offline message buffering, delivery on reconnect, single→double tick
const { cleanup, waitFor, wait, assert, results, setup2, client } = require('./helpers');

async function run() {
  console.log('🧪 Test Suite: Offline Message Delivery\n');

  // --- Single tick while offline, double tick after reconnect ---
  console.log('📌 Single→Double Tick (user offline then reconnects)');
  const s = await setup2('Alice', 'Bob');

  const lP = waitFor(s.creator.client, 'user-left');
  s.joiner.client.disconnect();
  await lP;
  console.log('  Bob disconnected');
  await wait(500);

  for (let i = 1; i <= 3; i++) {
    const oP = waitFor(s.creator.client, 'new-message');
    s.creator.client.emit('send-message', { roomCode: s.creator.roomCode, encryptedContent: `offline-${i}`, ttl: '5m' });
    const o = await oP;
    assert(o.status === 'sent', `Msg ${i} = sent (single tick)`);
  }
  console.log('  3 msgs sent while Bob offline');

  const bob2 = client();
  await waitFor(bob2, 'connect');
  const missed = [];
  const updates = [];
  bob2.on('new-message', m => missed.push(m));
  s.creator.client.on('message-status-update', u => updates.push(u));

  const rjP = waitFor(s.creator.client, 'user-rejoined');
  bob2.emit('rejoin-room', { roomCode: s.creator.roomCode, userId: s.joiner.userId, username: 'Bob' });
  await rjP;
  console.log('  Bob reconnected');
  await wait(1000);

  assert(missed.length === 3, `Bob got ${missed.length}/3 missed`);
  assert(missed[0]?.encryptedContent === 'offline-1', '1st msg correct');
  assert(missed[1]?.encryptedContent === 'offline-2', '2nd msg correct');
  assert(missed[2]?.encryptedContent === 'offline-3', '3rd msg correct');
  assert(updates.length >= 3, `Alice got ${updates.length}/3 delivery updates`);
  assert(updates.every(u => u.status === 'delivered'), 'All = delivered (double tick)');
  console.log('  ✨ single→double tick VERIFIED');
  cleanup(); await wait(800);

  // --- Creator offline, messages buffered, delivered on reconnect ---
  console.log('\n📌 Creator Offline Delivery');
  const s2 = await setup2('Alice', 'Bob');
  const l2 = waitFor(s2.joiner.client, 'user-left');
  s2.creator.client.disconnect();
  await l2; await wait(500);

  for (let i = 1; i <= 2; i++) {
    const oP = waitFor(s2.joiner.client, 'new-message');
    s2.joiner.client.emit('send-message', { roomCode: s2.creator.roomCode, encryptedContent: `cmiss-${i}`, ttl: '5m' });
    assert((await oP).status === 'sent', `Creator-msg ${i} = sent`);
  }

  const a2 = client();
  await waitFor(a2, 'connect');
  const cm = [];
  const cu = [];
  a2.on('new-message', m => cm.push(m));
  s2.joiner.client.on('message-status-update', u => cu.push(u));
  a2.emit('rejoin-room', { roomCode: s2.creator.roomCode, userId: s2.creator.userId, username: 'Alice', creatorToken: s2.creator.creatorToken });
  await wait(1000);

  assert(cm.length === 2, `Creator got ${cm.length}/2 missed`);
  assert(cu.length >= 2, `Bob got ${cu.length}/2 delivery updates`);
  cleanup(); await wait(800);

  // --- Multiple buffered messages ---
  console.log('\n📌 5 Buffered Messages');
  const s3 = await setup2('Alice', 'Bob');
  const l3 = waitFor(s3.creator.client, 'user-left');
  s3.joiner.client.disconnect();
  await l3; await wait(300);

  for (let i = 1; i <= 5; i++) {
    const oP = waitFor(s3.creator.client, 'new-message');
    s3.creator.client.emit('send-message', { roomCode: s3.creator.roomCode, encryptedContent: `buf-${i}`, ttl: '5m' });
    await oP;
  }
  await wait(300);

  const b3 = client();
  await waitFor(b3, 'connect');
  const bm = [];
  b3.on('new-message', m => bm.push(m));
  b3.emit('rejoin-room', { roomCode: s3.creator.roomCode, userId: s3.joiner.userId, username: 'Bob' });
  await wait(1000);

  assert(bm.length === 5, `Got ${bm.length}/5 buffered`);
  assert(bm[0]?.encryptedContent === 'buf-1', 'First correct');
  assert(bm[4]?.encryptedContent === 'buf-5', 'Last correct');
  cleanup();

  process.exit(results());
}

run().catch(e => { console.error('💥', e.message); cleanup(); process.exit(1); });
