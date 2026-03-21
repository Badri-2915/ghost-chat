// Test: Room creation, join flow, messaging, TTL, typing, deletion, panic delete
const { cleanup, waitFor, wait, assert, results, createRoom, setup2, client } = require('./helpers');

async function run() {
  console.log('🧪 Test Suite: Core Features\n');

  // --- Room Creation ---
  console.log('📌 Room Creation');
  const r = await createRoom('Alice');
  assert(r.roomCode.length === 8, 'Room code is 8 chars');
  assert(r.userId.length === 12, 'User ID is 12 chars');
  assert(r.username === 'Alice', 'Username matches');
  assert(r.isCreator === true, 'isCreator true');
  assert(r.creatorToken.length === 16, 'CreatorToken 16 chars');
  cleanup(); await wait(1000);

  // --- Join / Approve / Reject ---
  console.log('\n📌 Join Flow');
  const { creator, joiner } = await setup2('Alice', 'Bob');
  assert(joiner.roomCode === creator.roomCode, 'Joiner in correct room');

  const rejectee = client();
  await waitFor(rejectee, 'connect');
  const reqsP = waitFor(creator.client, 'join-requests-updated');
  rejectee.emit('join-request', { roomCode: creator.roomCode, username: 'Charlie' });
  const reqs = await reqsP;
  const rejectedP = waitFor(rejectee, 'join-rejected');
  creator.client.emit('reject-join', { roomCode: creator.roomCode, userId: Object.keys(reqs)[0] });
  await rejectedP;
  assert(true, 'Reject works');

  const bad = client();
  await waitFor(bad, 'connect');
  const errP = waitFor(bad, 'error-message');
  bad.emit('join-request', { roomCode: 'ZZZZZZZZ', username: 'X' });
  const err = await errP;
  assert(err.message.includes('not found'), 'Invalid room error');
  cleanup(); await wait(1000);

  // --- First Join = "joined" not "rejoined" ---
  console.log('\n📌 First Join Notification');
  const c2 = await createRoom('Alice');
  const joinedP = waitFor(c2.client, 'user-joined');
  const bob2 = client();
  await waitFor(bob2, 'connect');
  const rq2P = waitFor(c2.client, 'join-requests-updated');
  bob2.emit('join-request', { roomCode: c2.roomCode, username: 'Bob' });
  const rq2 = await rq2P;
  c2.client.emit('approve-join', { roomCode: c2.roomCode, userId: Object.keys(rq2)[0] });
  await waitFor(bob2, 'join-approved');
  const jd = await joinedP;
  assert(jd.username === 'Bob', 'user-joined event (not rejoined)');
  cleanup(); await wait(1000);

  // --- Messaging & Receipts ---
  console.log('\n📌 Messaging & Receipts');
  const s3 = await setup2('Alice', 'Bob');
  const msgP = waitFor(s3.joiner.client, 'new-message');
  s3.creator.client.emit('send-message', { roomCode: s3.creator.roomCode, encryptedContent: 'Hello', ttl: '5m' });
  const msg = await msgP;
  assert(msg.senderName === 'Alice', 'Sender correct');
  assert(msg.encryptedContent === 'Hello', 'Content correct');
  assert(msg.status === 'sent', 'Status = sent');
  assert(msg.ttlSeconds === 300, 'TTL 300s');

  const dP = waitFor(s3.creator.client, 'message-status-update');
  s3.joiner.client.emit('message-delivered', { roomCode: s3.creator.roomCode, messageId: msg.messageId });
  const d = await dP;
  assert(d.status === 'delivered', 'Delivered receipt');

  const rP = waitFor(s3.creator.client, 'message-status-update');
  s3.joiner.client.emit('message-read', { roomCode: s3.creator.roomCode, messageId: msg.messageId });
  const rd = await rP;
  assert(rd.status === 'read', 'Read receipt');
  cleanup(); await wait(1000);

  // --- TTL values ---
  console.log('\n📌 TTL Values');
  const s4 = await setup2('Alice', 'Bob');
  const ttls = { 'after-seen': 3, '5s': 5, '15s': 15, '30s': 30, '1m': 60, '5m': 300 };
  for (const [ttl, expected] of Object.entries(ttls)) {
    const p = waitFor(s4.joiner.client, 'new-message');
    s4.creator.client.emit('send-message', { roomCode: s4.creator.roomCode, encryptedContent: `t`, ttl });
    const m = await p;
    assert(m.ttlSeconds === expected, `TTL ${ttl} → ${expected}s`);
  }
  cleanup(); await wait(1000);

  // --- Typing ---
  console.log('\n📌 Typing');
  const s5 = await setup2('Alice', 'Bob');
  const tP = waitFor(s5.creator.client, 'user-typing');
  s5.joiner.client.emit('typing-start', { roomCode: s5.creator.roomCode });
  assert((await tP).username === 'Bob', 'Typing start');
  const tsP = waitFor(s5.creator.client, 'user-stopped-typing');
  s5.joiner.client.emit('typing-stop', { roomCode: s5.creator.roomCode });
  await tsP;
  assert(true, 'Typing stop');
  cleanup(); await wait(1000);

  // --- Delete & Panic ---
  console.log('\n📌 Delete & Panic');
  const s6 = await setup2('Alice', 'Bob');
  const m6P = waitFor(s6.joiner.client, 'new-message');
  s6.creator.client.emit('send-message', { roomCode: s6.creator.roomCode, encryptedContent: 'del', ttl: '5m' });
  const m6 = await m6P;
  const d6P = waitFor(s6.joiner.client, 'message-deleted');
  s6.creator.client.emit('delete-message', { roomCode: s6.creator.roomCode, messageId: m6.messageId, senderId: m6.senderId });
  await d6P;
  assert(true, 'Message deleted');

  const pp1 = waitFor(s6.creator.client, 'panic-delete');
  const pp2 = waitFor(s6.joiner.client, 'panic-delete');
  s6.creator.client.emit('panic-delete', { roomCode: s6.creator.roomCode });
  assert((await pp1).triggeredBy === 'Alice', 'Panic creator');
  assert((await pp2).triggeredBy === 'Alice', 'Panic joiner');
  cleanup(); await wait(1000);

  // --- Message length limit ---
  console.log('\n📌 Message Length');
  const s7 = await setup2('Alice', 'Bob');
  const okP = waitFor(s7.joiner.client, 'new-message');
  s7.creator.client.emit('send-message', { roomCode: s7.creator.roomCode, encryptedContent: 'x'.repeat(5000), ttl: '5m' });
  await okP;
  assert(true, '5000 chars OK');
  const eP = waitFor(s7.creator.client, 'error-message');
  s7.creator.client.emit('send-message', { roomCode: s7.creator.roomCode, encryptedContent: 'x'.repeat(5001), ttl: '5m' });
  assert((await eP).message.includes('too long'), '5001 chars rejected');
  cleanup();

  process.exit(results());
}

run().catch(e => { console.error('💥', e.message); cleanup(); process.exit(1); });
