// =============================================================================
// Landing.jsx — Entry screen for Ghost Chat.
//
// This is the first screen users see. It provides two modes:
//   1. "Create Room" — generates a new private room and makes the user the creator
//   2. "Join Room"  — submits a join request to an existing room by room code
//
// Additionally, if the user opens a deep link like /r/ROOMCODE, this component
// automatically pre-fills the room code and switches to join mode.
//
// State flows: Landing → (createRoom) → ChatRoom
//              Landing → (joinRoom)   → WaitingRoom → ChatRoom
// =============================================================================

// useState: local UI state for mode selection, name input, code input
// useEffect: runs once on mount to detect deep links in the URL
import { useState, useEffect } from 'react';

// useChat: provides createRoom, joinRoom actions + error string + connected boolean
import { useChat } from '../context/ChatContext';

// Lucide icons used throughout the landing screen:
// Ghost: app logo
// ArrowRight: chevron on mode selection cards
// Plus: icon on "Create Room" card
// LogIn: icon on "Join Room" card
// Shield, Timer, Lock: feature highlight icons at the bottom
import { Ghost, ArrowRight, Plus, LogIn, Shield, Timer, Lock } from 'lucide-react';

// Landing is the default screen — rendered when screen === 'landing' in ChatContext.
// It has no props; everything comes from the ChatContext via useChat().
export default function Landing() {
  // createRoom(name): emits 'create-room' to server → triggers room-created event
  // joinRoom(name, code): emits 'join-request' to server → triggers join-requested event
  // error: string set by ChatContext when server sends 'error-message'
  // connected: boolean — false until Socket.IO WebSocket handshake completes
  const { createRoom, joinRoom, error, connected } = useChat();

  // mode: controls which form is shown
  //   null     → show the two card buttons (Create / Join)
  //   'create' → show the Create Room form
  //   'join'   → show the Join Room form
  const [mode, setMode] = useState(null);

  // name: the display name the user types — passed to createRoom or joinRoom
  const [name, setName] = useState('');

  // code: the room code the user types — only used in 'join' mode
  // Can be pre-filled by deep link detection (see useEffect below)
  const [code, setCode] = useState('');

  // Deep link detection: runs once on mount.
  // Pattern: /r/ROOMCODE where ROOMCODE is 6+ URL-safe alphanumeric characters.
  // Example: opening badri.online/r/ABCD1234 pre-fills code='ABCD1234' and shows join form.
  // window.history.replaceState cleans the URL (removes /r/CODE) without a page reload,
  // so the browser address bar shows '/' after mount — prevents confusion on refresh.
  useEffect(() => {
    const path = window.location.pathname;                            // e.g. '/r/ABCD1234'
    const match = path.match(/^\/r\/([A-Za-z0-9_-]{6,})$/);         // extract ROOMCODE
    if (match) {
      setCode(match[1]);       // pre-fill the room code input field
      setMode('join');         // automatically open the Join Room form
      window.history.replaceState({}, '', '/'); // clean URL to '/' without reload
    }
  }, []); // empty deps: runs only once after the component mounts

  // handleCreate: form submission handler for the Create Room form.
  // Guards against empty names. Passes trimmed name to ChatContext's createRoom action.
  const handleCreate = (e) => {
    e.preventDefault();         // prevent default browser form submission / page reload
    if (!name.trim()) return;   // do nothing if name is blank or whitespace-only
    createRoom(name.trim());    // emit 'create-room' → server → 'room-created' response
  };

  // handleJoin: form submission handler for the Join Room form.
  // Guards against empty name or code. Passes both to ChatContext's joinRoom action.
  const handleJoin = (e) => {
    e.preventDefault();                        // prevent page reload
    if (!name.trim() || !code.trim()) return;  // both fields are required
    joinRoom(name.trim(), code.trim());        // emit 'join-request' → server → 'join-requested'
  };

  return (
    // Full-screen centered layout with top/bottom padding for mobile scroll safety
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8">

      {/* ------------------------------------------------------------------ */}
      {/* Decorative background glow blobs — purely visual, pointer-events-none */}
      {/* Two radial gradient orbs positioned top-left and bottom-right */}
      {/* ------------------------------------------------------------------ */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-ghost-600/20 rounded-full blur-[128px]" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-ghost-400/10 rounded-full blur-[128px]" />
      </div>

      {/* Main content container — max width 448px, centered */}
      <div className="relative z-10 w-full max-w-md">

        {/* ---------------------------------------------------------------- */}
        {/* App logo + title + tagline                                        */}
        {/* ---------------------------------------------------------------- */}
        <div className="text-center mb-10">
          {/* Ghost icon inside a purple gradient square — the app logo */}
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl ghost-gradient mb-4 shadow-lg shadow-ghost-600/30">
            <Ghost className="w-10 h-10 text-white" />
          </div>

          {/* App name: 'Ghost' in white, 'Chat' in ghost-purple */}
          <h1 className="text-4xl font-bold tracking-tight">
            Ghost <span className="text-ghost-400">Chat</span>
          </h1>

          {/* Tagline — one sentence describing the app */}
          <p className="text-white/50 mt-2 text-sm">
            Privacy-first ephemeral messaging
          </p>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Connection status banner                                          */}
        {/* Shown briefly while Socket.IO WebSocket is establishing.          */}
        {/* Disappears as soon as 'connect' event fires (connected = true).   */}
        {/* ---------------------------------------------------------------- */}
        {!connected && (
          <div className="text-center mb-4 text-yellow-400/80 text-sm">
            Connecting to server...
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Error banner                                                       */}
        {/* Populated by ChatContext when the server emits 'error-message'.   */}
        {/* Examples: 'Room not found', 'Room creator is not available'        */}
        {/* ---------------------------------------------------------------- */}
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Mode selection: shown when mode === null (initial state)           */}
        {/* Two full-width card buttons — Create Room and Join Room            */}
        {/* Both are disabled while !connected to prevent premature emissions  */}
        {/* ---------------------------------------------------------------- */}
        {!mode && (
          <div className="space-y-3">

            {/* Create Room card — switches mode to 'create' */}
            <button
              onClick={() => setMode('create')}
              disabled={!connected}  // can't create if not yet connected to server
              className="w-full glass-card p-5 flex items-center gap-4 hover:bg-white/10 transition-all group"
            >
              {/* Purple gradient icon box — scales slightly on hover via group-hover */}
              <div className="w-12 h-12 rounded-xl ghost-gradient flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <Plus className="w-6 h-6" />
              </div>

              {/* Card text */}
              <div className="text-left">
                <div className="font-semibold text-lg">Create Room</div>
                <div className="text-white/40 text-sm">Start a new private conversation</div>
              </div>

              {/* Arrow — brightens on hover to indicate interactivity */}
              <ArrowRight className="w-5 h-5 text-white/30 ml-auto group-hover:text-white/60 transition-colors" />
            </button>

            {/* Join Room card — switches mode to 'join' */}
            <button
              onClick={() => setMode('join')}
              disabled={!connected}  // can't join if not yet connected to server
              className="w-full glass-card p-5 flex items-center gap-4 hover:bg-white/10 transition-all group"
            >
              {/* Muted icon box (white/10 background, not gradient — indicates secondary action) */}
              <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <LogIn className="w-6 h-6 text-ghost-400" />
              </div>

              {/* Card text */}
              <div className="text-left">
                <div className="font-semibold text-lg">Join Room</div>
                <div className="text-white/40 text-sm">Enter with a secret room code</div>
              </div>

              {/* Arrow */}
              <ArrowRight className="w-5 h-5 text-white/30 ml-auto group-hover:text-white/60 transition-colors" />
            </button>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Create Room Form — shown when mode === 'create'                   */}
        {/* Single input: display name. Submits via handleCreate.             */}
        {/* ---------------------------------------------------------------- */}
        {mode === 'create' && (
          <form onSubmit={handleCreate} className="glass-card p-6 space-y-4">

            {/* Form header with back button */}
            <div className="flex items-center gap-2 mb-2">
              {/* Back button returns to the mode selection cards */}
              <button
                type="button"
                onClick={() => setMode(null)}
                className="text-white/40 hover:text-white transition-colors text-sm"
              >
                &larr; Back
              </button>
              <h2 className="font-semibold text-lg">Create Room</h2>
            </div>

            {/* Display name input */}
            <div>
              <label className="text-white/50 text-sm mb-1 block">Your name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)} // controlled input
                placeholder="Enter a display name"
                className="ghost-input"  // from index.css: rounded dark input with focus ring
                maxLength={20}           // server limit: names max 20 chars
                autoFocus               // keyboard opens immediately on mobile
              />
            </div>

            {/* Submit button — disabled if name is empty/whitespace */}
            <button type="submit" disabled={!name.trim()} className="ghost-btn w-full">
              Create Private Room
            </button>
          </form>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Join Room Form — shown when mode === 'join'                       */}
        {/* Two inputs: display name + room code. Submits via handleJoin.     */}
        {/* Room code may be pre-filled by deep link detection (useEffect).   */}
        {/* ---------------------------------------------------------------- */}
        {mode === 'join' && (
          <form onSubmit={handleJoin} className="glass-card p-6 space-y-4">

            {/* Form header with back button */}
            <div className="flex items-center gap-2 mb-2">
              <button
                type="button"
                onClick={() => setMode(null)}
                className="text-white/40 hover:text-white transition-colors text-sm"
              >
                &larr; Back
              </button>
              <h2 className="font-semibold text-lg">Join Room</h2>
            </div>

            {/* Display name input */}
            <div>
              <label className="text-white/50 text-sm mb-1 block">Your name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)} // controlled
                placeholder="Enter a display name"
                className="ghost-input"
                maxLength={20}
                autoFocus
              />
            </div>

            {/* Room code input — font-mono for better readability of alphanumeric code */}
            <div>
              <label className="text-white/50 text-sm mb-1 block">Room code</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)} // controlled
                placeholder="Enter secret room code"
                className="ghost-input font-mono" // monospace font for code readability
              />
            </div>

            {/* Submit button — disabled if either field is blank */}
            <button
              type="submit"
              disabled={!name.trim() || !code.trim()} // both fields required
              className="ghost-btn w-full"
            >
              Request to Join
            </button>
          </form>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Feature highlights — 3-column grid at the bottom of the page     */}
        {/* These are purely informational — no interactivity                 */}
        {/* Icons: Lock (E2EE), Timer (auto-delete), Shield (no data)         */}
        {/* ---------------------------------------------------------------- */}
        <div className="mt-10 grid grid-cols-3 gap-4 text-center">

          {/* Feature 1: End-to-End Encryption */}
          <div className="space-y-2">
            <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center mx-auto">
              <Lock className="w-5 h-5 text-ghost-400" />
            </div>
            <p className="text-xs text-white/40">End-to-End Encrypted</p>
          </div>

          {/* Feature 2: Auto-delete messages */}
          <div className="space-y-2">
            <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center mx-auto">
              <Timer className="w-5 h-5 text-ghost-400" />
            </div>
            <p className="text-xs text-white/40">Auto-Delete Messages</p>
          </div>

          {/* Feature 3: No data stored (no database, no accounts) */}
          <div className="space-y-2">
            <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center mx-auto">
              <Shield className="w-5 h-5 text-ghost-400" />
            </div>
            <p className="text-xs text-white/40">No Data Stored</p>
          </div>
        </div>
      </div>
    </div>
  );
}
