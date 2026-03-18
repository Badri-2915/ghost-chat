// Client-side E2EE using Web Crypto API
// Key exchange: ECDH (Elliptic Curve Diffie-Hellman)
// Encryption: AES-GCM (symmetric)

export async function generateKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
  return keyPair;
}

export async function exportPublicKey(publicKey) {
  const exported = await crypto.subtle.exportKey('jwk', publicKey);
  return JSON.stringify(exported);
}

export async function importPublicKey(jwkString) {
  const jwk = JSON.parse(jwkString);
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

export async function deriveSharedKey(privateKey, otherPublicKey) {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: otherPublicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptMessage(sharedKey, plaintext) {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = encoder.encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    data
  );

  return {
    iv: arrayBufferToBase64(iv),
    ciphertext: arrayBufferToBase64(ciphertext),
  };
}

export async function decryptMessage(sharedKey, { iv, ciphertext }) {
  const decoder = new TextDecoder();
  const ivBuffer = base64ToArrayBuffer(iv);
  const ctBuffer = base64ToArrayBuffer(ciphertext);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    sharedKey,
    ctBuffer
  );

  return decoder.decode(plaintext);
}

// For rooms with multiple users, we use a room-level shared secret
// derived from a passphrase (the room code acts as the shared secret)
export async function deriveRoomKey(roomCode) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(roomCode),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('ghost-chat-salt'),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
