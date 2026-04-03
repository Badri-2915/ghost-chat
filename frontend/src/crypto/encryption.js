// =============================================================================
// encryption.js — Client-side End-to-End Encryption for Ghost Chat.
//
// Architecture:
//   - Room key derivation: PBKDF2(roomCode, salt) → AES-GCM-256 key
//   - Per-room key: all users derive the same key from the same room code
//   - Encryption: AES-GCM with a random 12-byte IV per message
//   - The server only ever sees ciphertext { iv, ciphertext } — never plaintext
//
// ECDH functions (generateKeyPair, exportPublicKey, importPublicKey, deriveSharedKey)
// are defined but not used in the current flow — the app uses room-key derivation instead.
// They are retained for potential future pairwise key exchange.
// =============================================================================

// Generate an ECDH key pair (public + private) using the P-256 curve.
// The public key can be shared; the private key is kept local.
// 'deriveKey' usage allows this key pair to be used to derive a shared AES key.
// Not currently used in room messaging — retained for potential future pairwise E2EE.
export async function generateKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, // P-256 = NIST standard curve, widely supported
    true,          // exportable — we need to export the public key to share it
    ['deriveKey']  // intended usage: derive a shared symmetric key via ECDH
  );
  return keyPair; // { publicKey: CryptoKey, privateKey: CryptoKey }
}

// Export a CryptoKey public key to a JSON Web Key (JWK) string for transmission.
// JWK format is a JSON object describing the key — safe to send over the wire.
export async function exportPublicKey(publicKey) {
  const exported = await crypto.subtle.exportKey('jwk', publicKey); // JWK format
  return JSON.stringify(exported); // Serialize to string for Socket.IO transmission
}

// Import a JWK-encoded public key string back into a CryptoKey object.
// Used when receiving another user's public key for ECDH key agreement.
export async function importPublicKey(jwkString) {
  const jwk = JSON.parse(jwkString); // Deserialize the JWK string
  return crypto.subtle.importKey(
    'jwk',                            // Input format
    jwk,                              // The parsed JWK object
    { name: 'ECDH', namedCurve: 'P-256' }, // Must match the curve used in generateKeyPair
    true,                             // exportable
    []                                // No usage restrictions — only used for ECDH derivation
  );
}

// Derive a shared AES-GCM-256 key from one party's private key and the other's public key.
// Both parties independently run this and arrive at the SAME derived key (ECDH property).
// The derived key is non-extractable (false) — it lives only in the browser's crypto context.
export async function deriveSharedKey(privateKey, otherPublicKey) {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: otherPublicKey }, // ECDH: use their public key + your private key
    privateKey,                               // Your private key
    { name: 'AES-GCM', length: 256 },        // Derive a 256-bit AES-GCM symmetric key
    false,                                    // Non-extractable: key stays in browser memory only
    ['encrypt', 'decrypt']                    // The derived key will be used for AES-GCM operations
  );
}

// Encrypt a plaintext string using AES-GCM-256.
// A fresh 12-byte random IV is generated per message — MUST never be reused with the same key.
// Returns { iv: base64, ciphertext: base64 } — both fields needed for decryption.
export async function encryptMessage(sharedKey, plaintext) {
  const encoder = new TextEncoder();   // Converts string to UTF-8 bytes (Uint8Array)

  // Generate a cryptographically random 12-byte IV (96 bits — recommended for AES-GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encode the plaintext string as raw bytes
  const data = encoder.encode(plaintext);

  // Perform AES-GCM encryption — the result is an ArrayBuffer (ciphertext + auth tag)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },  // Algorithm + IV (GCM uses the IV as a nonce)
    sharedKey,                 // The AES-GCM key derived from the room code
    data                       // The plaintext bytes to encrypt
  );

  // Encode both IV and ciphertext as base64 strings for JSON-safe transmission
  return {
    iv: arrayBufferToBase64(iv),               // 12-byte IV as base64 (~16 chars)
    ciphertext: arrayBufferToBase64(ciphertext), // Encrypted payload as base64
  };
}

// Decrypt an AES-GCM-256 encrypted payload.
// Accepts the same { iv, ciphertext } shape returned by encryptMessage.
// Throws if the key is wrong, the IV doesn't match, or the auth tag fails — prevents tampering.
export async function decryptMessage(sharedKey, { iv, ciphertext }) {
  const decoder = new TextDecoder();              // Converts decrypted bytes back to string

  const ivBuffer = base64ToArrayBuffer(iv);       // Decode base64 IV to ArrayBuffer
  const ctBuffer = base64ToArrayBuffer(ciphertext); // Decode base64 ciphertext to ArrayBuffer

  // Perform AES-GCM decryption — verifies the authentication tag automatically
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuffer }, // Must use the exact same IV as encryption
    sharedKey,                          // Must be the same key used for encryption
    ctBuffer                            // The ciphertext + auth tag ArrayBuffer
  );

  return decoder.decode(plaintext); // Decode the decrypted bytes back to a UTF-8 string
}

// Derive a shared room-level AES-GCM-256 key from the room code using PBKDF2.
// All users with the same room code derive the SAME key — this is the basis of E2EE.
// PBKDF2 with 100,000 iterations makes brute-force guessing of the room code computationally expensive.
// Note: the room code (8 chars from nanoid) has ~48 bits of entropy — adequate for ephemeral use.
export async function deriveRoomKey(roomCode) {
  const encoder = new TextEncoder();

  // Step 1: Import the room code as raw key material for PBKDF2.
  // PBKDF2 is a password-based KDF — it stretches low-entropy inputs into high-entropy keys.
  const keyMaterial = await crypto.subtle.importKey(
    'raw',                    // Input format: raw bytes
    encoder.encode(roomCode), // The room code as UTF-8 bytes (the "password")
    { name: 'PBKDF2' },       // This key will be used as PBKDF2 input
    false,                    // Non-extractable — stays in browser's crypto engine
    ['deriveKey']             // Usage: derive another key from this material
  );

  // Step 2: Derive the actual AES-GCM-256 encryption key using PBKDF2.
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('ghost-chat-salt'), // Fixed salt — same for all rooms (sufficient for ephemeral use)
      iterations: 100000,                      // 100k iterations — standard for PBKDF2 key derivation
      hash: 'SHA-256',                         // PRF used internally by PBKDF2
    },
    keyMaterial,                    // The imported room code material from Step 1
    { name: 'AES-GCM', length: 256 }, // Output: 256-bit AES-GCM key
    false,                          // Non-extractable — key cannot be read from memory
    ['encrypt', 'decrypt']          // The derived key is used for message encryption/decryption
  );
}

// Convert an ArrayBuffer (or Uint8Array) to a base64-encoded string.
// Used to serialize binary crypto outputs (IV, ciphertext) for JSON transmission.
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer); // View the buffer as bytes
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]); // Convert each byte to a character
  }
  return btoa(binary); // Base64-encode the binary string
}

// Convert a base64-encoded string back to an ArrayBuffer.
// Used to deserialize IV and ciphertext received in a message payload.
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);              // Decode base64 to binary string
  const bytes = new Uint8Array(binary.length); // Allocate byte array
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i); // Convert each character back to its byte value
  }
  return bytes.buffer; // Return the underlying ArrayBuffer
}
