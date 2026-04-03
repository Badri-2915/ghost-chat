// =============================================================================
// ChatRoom.jsx -- Main chat interface for Ghost Chat.
//
// Rendered when screen === 'chat' (user is approved and inside an active room).
// Composes all child components into a full-screen layout:
//
//   ToastContainer   -- floating notifications (z-50 fixed overlay)
//   Disconnect overlay -- shown when socket is disconnected (z-90 fixed)
//   Header           -- room code, copy, connection dot, user count, panic/sidebar buttons
//   Messages area    -- scrollable list of MessageBubble components
//   Scroll button    -- "N new messages" / chevron down (when not at bottom)
//   TypingIndicator  -- animated dots + "X is typing"
//   Reply bar        -- shows quoted message when replyTo is set
//   Input form       -- TTL picker popover + text input + send button
//   Sidebar          -- slide-in panel: room info, JoinRequests, UserList, leave button
//
// Local state (UI-only, not in context):
//   text            -- current input value
//   showSidebar     -- whether the right-side info panel is visible
//   copied          -- brief "Copied!" flash after copy/share
//   confirmPanic    -- two-click panic confirm state
//   showTimerPicker -- whether the TTL popover is open
//   atBottom        -- whether scroll is at the bottom of the message list
//   newMsgCount     -- count of messages received while user is scrolled up
// =============================================================================

// useState: local UI state (text input, sidebar, panic confirm, etc.)
// useRef:   DOM refs (scroll container, end sentinel, input, typing timeout)
// useEffect: auto-scroll, focus, sidebar click-away
// useCallback: memoized handlers (send, input change, copy, panic, scroll)
import { useState, useRef, useEffect, useCallback } from 'react';

// Lucide icons:
// Send: submit button icon
// Copy: copy room code to clipboard
// Ghost: app logo in header
// Wifi/WifiOff: (imported but not individually rendered -- WifiOff used in disconnect overlay)
// Users: sidebar toggle button
// X: close sidebar on mobile
// Shield: encryption badge in sidebar
// AlertTriangle: (available, not currently used)
// Bomb: panic delete button
// Reply: (available, not currently used in header -- used in MessageBubble)
// LogOut: leave room button
// ChevronDown: scroll-to-bottom button
// Timer: TTL picker toggle button
// Share2: share room link button in sidebar
import { Send, Copy, Ghost, Wifi, WifiOff, Users, X, Shield, AlertTriangle, Bomb, Reply, LogOut, ChevronDown, Timer, Share2 } from 'lucide-react';

// useChat: access all global chat state and actions
import { useChat } from '../context/ChatContext';

// Child components:
import MessageBubble from './MessageBubble';       // renders one message bubble
import TypingIndicator from './TypingIndicator';   // animated "X is typing..."
import TimerSelector from './TimerSelector';       // TTL picker popover (after-seen/5s/..5m)
import UserList from './UserList';                 // sidebar: room members with presence dots
import JoinRequests from './JoinRequests';         // sidebar: pending join requests (creator only)
import ToastContainer from './ToastContainer';     // floating toast notifications

export default function ChatRoom() {
  // --- Context values ---
  // username:     current user's display name (shown in sidebar + sent with messages)
  // roomCode:     8-char room identifier (shown in header, used for deep links)
  // userId:       current user's session ID
  // isCreator:    true if this user created the room (shows join requests, crown icon)
  // users:        { [userId]: { username, joinedAt } } -- all active room members
  // messages:     array of decrypted message objects rendered as MessageBubble components
  // connected:    Socket.IO connection state -- false shows disconnect overlay
  // reconnecting: true while Socket.IO is attempting to reconnect
  // error:        error string from server (shown in header banner)
  // sendMessage:  action -- encrypts + emits 'send-message' to server
  // startTyping:  action -- emits 'typing-start' to server
  // stopTyping:   action -- emits 'typing-stop' to server
  // panicDelete:  action -- emits 'panic-delete', wipes all messages for everyone
  // replyTo:      message object currently being replied to (null if not replying)
  // setReplyTo:   updates replyTo in context (null to clear the reply bar)
  // leaveRoom:    action -- emits 'leave-room', clears session, returns to landing
  const {
    username,
    roomCode,
    userId,
    isCreator,
    users,
    messages,
    connected,
    reconnecting,
    error,
    sendMessage,
    startTyping,
    stopTyping,
    panicDelete,
    replyTo,
    setReplyTo,
    leaveRoom,
  } = useChat();

  // text: current value of the message input field (controlled input)
  const [text, setText] = useState('');

  // showSidebar: controls visibility of the right-side room info panel
  const [showSidebar, setShowSidebar] = useState(false);

  // copied: triggers a brief "Copied!" label after copying the room link
  const [copied, setCopied] = useState(false);

  // confirmPanic: two-step panic delete safety -- first click arms it (3s window),
  //               second click within that window executes panic delete
  const [confirmPanic, setConfirmPanic] = useState(false);

  // showTimerPicker: whether the TTL picker popover is open above the Timer button
  const [showTimerPicker, setShowTimerPicker] = useState(false);

  // atBottom: true when the scroll container is within 80px of the bottom.
  //           Controls auto-scroll behavior and the new-message indicator button.
  const [atBottom, setAtBottom] = useState(true);

  // newMsgCount: number of new messages received while user is scrolled up.
  //              Shown as "N new messages" on the scroll-to-bottom button.
  const [newMsgCount, setNewMsgCount] = useState(0);

  // messagesEndRef: empty div at the bottom of the message list.
  //                 scrollIntoView() on this element scrolls to the newest message.
  const messagesEndRef = useRef(null);

  // messagesContainerRef: the scrollable div containing all MessageBubble components.
  //                        Used to read scrollTop/scrollHeight in handleScroll.
  const messagesContainerRef = useRef(null);

  // typingTimeoutRef: holds the 2-second debounce timer for typing stop detection.
  //                   When the user stops typing for 2s, stopTyping() is called.
  const typingTimeoutRef = useRef(null);

  // inputRef: direct ref to the message input element.
  //           Used to programmatically focus when a reply is selected.
  const inputRef = useRef(null);

  // userCount: derived from the users map -- shown in the header as "N users"
  const userCount = Object.keys(users).length;

  // ---------------------------------------------------------------------------
  // Effect: auto-scroll to bottom when new messages arrive
  // ---------------------------------------------------------------------------
  // Runs whenever messages.length changes (new message added or message deleted).
  // If user is at the bottom (atBottom): scroll to newest message, reset count.
  // If user is scrolled up: increment newMsgCount (shown on scroll button).
  // eslint-disable-next-line react-hooks/exhaustive-deps disables the warning about
  // atBottom not being in deps -- intentional: we read it as a snapshot, not reactively.
  useEffect(() => {
    if (atBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setNewMsgCount(0);
    } else if (messages.length > 0) {
      setNewMsgCount((prev) => prev + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // ---------------------------------------------------------------------------
  // handleScroll: called on every scroll event in the messages container
  // ---------------------------------------------------------------------------
  // threshold of 80px: user is considered "at bottom" if within 80px of end.
  // This prevents auto-scroll from interrupting the user while reading older messages.
  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const threshold = 80;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setAtBottom(isAtBottom);
    if (isAtBottom) setNewMsgCount(0); // clear unread count when user scrolls to bottom
  }, []);

  // ---------------------------------------------------------------------------
  // Effect: focus the text input whenever a reply is selected
  // ---------------------------------------------------------------------------
  // When the user taps "Reply" (via swipe or menu), replyTo becomes non-null.
  // We immediately focus the input so they can start typing the reply.
  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  // scrollToBottom: manually scroll to bottom (called by the scroll indicator button)
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setAtBottom(true);
    setNewMsgCount(0);
  }, []);

  // ---------------------------------------------------------------------------
  // handleSend: form submit handler for the message input
  // ---------------------------------------------------------------------------
  // Prevents empty sends. Calls context sendMessage() which encrypts + emits.
  // After sending: clears input, stops typing indicator, resets scroll position,
  // and cancels any pending typing-stop debounce timer.
  const handleSend = useCallback(
    (e) => {
      e.preventDefault();               // prevent default form submission
      if (!text.trim()) return;         // ignore empty or whitespace-only messages
      sendMessage(text.trim());         // encrypt + emit 'send-message' to server
      setText('');                      // clear the input field
      stopTyping();                     // emit 'typing-stop' immediately
      setAtBottom(true);                // scroll will jump to bottom for next message
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current); // cancel the 2s debounce
        typingTimeoutRef.current = null;
      }
    },
    [text, sendMessage, stopTyping]
  );

  // ---------------------------------------------------------------------------
  // handleInputChange: called on every keystroke in the message input
  // ---------------------------------------------------------------------------
  // Updates text state. Emits 'typing-start' on every keystroke.
  // Resets a 2-second debounce: if no keystroke for 2s, emits 'typing-stop'.
  // This prevents the typing indicator from staying visible after the user stops.
  const handleInputChange = useCallback(
    (e) => {
      setText(e.target.value);          // update controlled input value
      startTyping();                    // emit 'typing-start' to server
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        stopTyping();                   // emit 'typing-stop' after 2s of inactivity
      }, 2000);
    },
    [startTyping, stopTyping]
  );

  // roomLink: the shareable deep link for this room
  // Format: https://badri.online/r/ROOMCODE
  // When opened, Landing.jsx detects /r/ROOMCODE and pre-fills the join form.
  const roomLink = `${window.location.origin}/r/${roomCode}`;

  // copyRoomCode: copies the full room link to clipboard and shows "Copied!" for 2s
  const copyRoomCode = useCallback(() => {
    navigator.clipboard.writeText(roomLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [roomLink]);

  // ---------------------------------------------------------------------------
  // shareRoomCode: uses Web Share API if available, falls back to clipboard copy
  // ---------------------------------------------------------------------------
  // navigator.share: available on mobile browsers and some desktop Chrome/Edge.
  // navigator.canShare: checks if the share data is valid for the current platform.
  // Fallback: copies text to clipboard (same as copyRoomCode).
  const shareRoomCode = useCallback(async () => {
    const shareText = `Join my Ghost Chat room!\n\n${roomLink}`;
    const shareData = { title: 'Ghost Chat — Join My Room', text: shareText };
    try {
      if (navigator.share && navigator.canShare?.(shareData)) {
        await navigator.share(shareData); // native share sheet (mobile)
      } else {
        await navigator.clipboard.writeText(shareText); // clipboard fallback
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (e) {
      // User cancelled the share dialog — no action needed
    }
  }, [roomLink]);

  // ---------------------------------------------------------------------------
  // handlePanicDelete: two-step confirmation for panic delete
  // ---------------------------------------------------------------------------
  // First click: sets confirmPanic=true (button turns red + pulses for 3 seconds).
  // Second click within 3 seconds: calls panicDelete() which wipes all messages.
  // If no second click within 3s: confirmPanic resets to false automatically.
  const handlePanicDelete = useCallback(() => {
    if (!confirmPanic) {
      setConfirmPanic(true);                           // arm the panic button
      setTimeout(() => setConfirmPanic(false), 3000); // auto-disarm after 3s
      return;
    }
    panicDelete();           // emit 'panic-delete' to server -- deletes all messages for all users
    setConfirmPanic(false);  // reset button state
  }, [confirmPanic, panicDelete]);

  // ---------------------------------------------------------------------------
  // Effect: click-away to close sidebar on mobile
  // ---------------------------------------------------------------------------
  // Adds a document-level click listener when sidebar is open.
  // If the click target is outside the <aside> element, the sidebar closes.
  // Cleanup removes the listener when sidebar closes or component unmounts.
  useEffect(() => {
    if (!showSidebar) return;
    const close = (e) => {
      if (e.target.closest('aside')) return; // click inside sidebar: do nothing
      setShowSidebar(false);                 // click outside: close sidebar
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close); // cleanup
  }, [showSidebar]);

  return (
    // Full-screen flex column: header (fixed height) + main content (flex-1)
    <div className="h-screen flex flex-col bg-ghost-950">

      {/* ------------------------------------------------------------------ */}
      {/* ToastContainer: floating notification system.                       */}
      {/* Renders above everything else (z-50). Shows join requests (with     */}
      {/* Accept/Reject buttons for creator), alerts, warnings, etc.         */}
      {/* ------------------------------------------------------------------ */}
      <ToastContainer />

      {/* ------------------------------------------------------------------ */}
      {/* Disconnect overlay: covers the entire screen when socket drops.    */}
      {/* z-[90] sits above all content but below any z-[100] modals.        */}
      {/* Shows a spinning reconnect indicator while Socket.IO retries.      */}
      {/* The underlying ChatRoom remains mounted so state is preserved.     */}
      {/* ------------------------------------------------------------------ */}
      {!connected && (
        <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center">
          <div className="glass-card p-6 max-w-xs w-full mx-4 text-center space-y-3">
            {/* WifiOff: red signal icon indicating disconnection */}
            <WifiOff className="w-8 h-8 text-red-400 mx-auto" />
            <h3 className="font-semibold text-base">Connection Lost</h3>
            {/* Dynamic message: 'Reconnecting...' while Socket.IO retries, 'Waiting...' otherwise */}
            <p className="text-white/50 text-sm">
              {reconnecting ? 'Reconnecting to server...' : 'Waiting for network...'}
            </p>
            {/* Animated spinner */}
            <div className="flex justify-center">
              <div className="w-5 h-5 border-2 border-ghost-400 border-t-transparent rounded-full animate-spin" />
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Header: sticky top bar with room code, status, and action buttons   */}
      {/* shrink-0: prevents header from being compressed by flex-1 main      */}
      {/* backdrop-blur-sm: frosted-glass effect over the message list        */}
      {/* ------------------------------------------------------------------ */}
      <header className="shrink-0 border-b border-white/5 bg-ghost-950/95 backdrop-blur-sm z-20">
        <div className="flex items-center justify-between px-3 py-2.5">

          {/* --- Left side: app logo + room code + status row --- */}
          <div className="flex items-center gap-2.5 min-w-0">

            {/* Ghost logo icon (small, ghost-gradient purple) */}
            <div className="w-8 h-8 rounded-lg ghost-gradient flex items-center justify-center shrink-0">
              <Ghost className="w-4 h-4" />
            </div>

            <div className="min-w-0">
              {/* Room code button: clicking copies the room link to clipboard */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={copyRoomCode}
                  className="flex items-center gap-1 text-xs font-mono text-white/60 hover:text-white/90 transition-colors"
                >
                  {roomCode}              {/* 8-char room code shown in monospace */}
                  <Copy className="w-3 h-3" />
                </button>
                {/* Brief 'Copied!' confirmation (visible for 2s after copy) */}
                {copied && <span className="text-green-400 text-[10px] font-medium">Copied!</span>}
              </div>

              {/* Status row: connection dot + encrypted/offline + user count */}
              <div className="flex items-center gap-1.5 text-[11px] text-white/30">
                {/* Green dot = connected, red dot = disconnected */}
                <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
                <span>{connected ? 'Encrypted' : 'Offline'}</span>
                <span className="text-white/15">·</span>
                {/* User count with singular/plural grammar */}
                <span>{userCount} {userCount === 1 ? 'user' : 'users'}</span>
              </div>
            </div>
          </div>

          {/* --- Right side: panic delete + sidebar toggle --- */}
          <div className="flex items-center gap-1.5">

            {/* Panic delete button.
                Normal state: muted bomb icon (bg-white/5).
                Armed state (confirmPanic=true): red ring + pulse animation for 3s.
                Two clicks required to avoid accidental full message wipe. */}
            <button
              onClick={handlePanicDelete}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                confirmPanic
                  ? 'bg-red-500/30 ring-1 ring-red-400 animate-pulse' // armed: red pulse
                  : 'bg-white/5 hover:bg-red-500/20'                  // normal: subtle hover
              }`}
              title={confirmPanic ? 'Click again to confirm' : 'Delete all messages'}
            >
              <Bomb className={`w-3.5 h-3.5 ${confirmPanic ? 'text-red-400' : 'text-white/40'}`} />
            </button>

            {/* Sidebar toggle button.
                Active state: ghost-purple tint indicating sidebar is open.
                stopPropagation prevents the click-away handler from closing it immediately. */}
            <button
              onClick={(e) => { e.stopPropagation(); setShowSidebar(!showSidebar); }}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                showSidebar ? 'bg-ghost-600/30 text-ghost-400' : 'bg-white/5 hover:bg-white/10 text-white/40'
              }`}
              title="Users & info"
            >
              <Users className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Error banner: shown below header row when server sends an error.
            Examples: 'Room not found', 'Rate limit exceeded'. */}
        {error && (
          <div className="px-3 pb-2">
            <div className="text-xs text-red-400 text-center bg-red-500/10 rounded-lg px-3 py-1.5">
              {error}
            </div>
          </div>
        )}
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Main content row: flex-1 fills remaining height below header.       */}
      {/* Contains: messages area (flex-1) + optional sidebar (fixed width)   */}
      {/* overflow-hidden: prevents inner scroll from leaking to the window   */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-1 overflow-hidden relative">

        {/* -------------------------------------------------------------- */}
        {/* Messages area: flex column containing scroll container +        */}
        {/* scroll indicator + typing indicator + reply bar + input form    */}
        {/* -------------------------------------------------------------- */}
        <main className="flex-1 flex flex-col min-w-0">

          {/* Message scroll container.
              flex-1: takes all available height between header and input.
              overflow-y-auto: enables vertical scrolling for message history.
              onScroll: updates atBottom state and newMsgCount tracking.
              space-y-1.5: small gap between consecutive message bubbles. */}
          <div
            ref={messagesContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5 sm:px-4"
          >
            {/* Empty state: shown when no messages have been sent yet.
                Centered ghost icon + room code share shortcut. */}
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-white/20 space-y-3">
                <Ghost className="w-10 h-10" />
                <p className="text-sm">No messages yet</p>
                {/* Quick share shortcut -- copies the room link */}
                <button onClick={copyRoomCode} className="text-xs text-ghost-400/50 hover:text-ghost-400 transition-colors">
                  Share code <span className="font-mono">{roomCode}</span> to invite others
                </button>
              </div>
            )}

            {/* Render each message as a MessageBubble.
                key={msg.messageId}: stable React key prevents re-mount on list changes.
                The full message object is passed as prop -- MessageBubble handles
                all display, TTL countdown, and receipt tracking internally. */}
            {messages.map((msg) => (
              <MessageBubble key={msg.messageId} message={msg} />
            ))}

            {/* Invisible sentinel div at end of list.
                messagesEndRef.scrollIntoView() scrolls here to show newest message. */}
            <div ref={messagesEndRef} />
          </div>

          {/* Scroll-to-bottom button: only shown when user has scrolled up.
              Shows "N new messages" label when unread messages have arrived.
              bottom-28: positioned above the input form (approx 7rem from bottom).
              Clicking calls scrollToBottom() which also resets newMsgCount. */}
          {!atBottom && messages.length > 0 && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-28 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-ghost-600/90 backdrop-blur-sm shadow-lg hover:bg-ghost-600 transition-colors z-10 text-xs font-medium"
            >
              {/* Show count if new messages arrived while scrolled up, else just a chevron */}
              {newMsgCount > 0 ? (
                <>{newMsgCount} new {newMsgCount === 1 ? 'message' : 'messages'} <ChevronDown className="w-3.5 h-3.5" /></>
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          {/* TypingIndicator: shows "X is typing..." with animated dots.
              Reads typingUsers from ChatContext, excludes current userId.
              Auto-hides when no one is typing. */}
          <TypingIndicator />

          {/* Reply bar: shown when the user has selected a message to reply to.
              Displays a purple left-border accent + sender name + truncated quote.
              X button calls setReplyTo(null) to dismiss the reply context.
              Cleared automatically when handleSend() fires. */}
          {replyTo && (
            <div className="shrink-0 border-t border-white/5 px-3 py-2 flex items-center gap-2 bg-ghost-900/50">
              {/* Purple accent bar on the left -- matches reply preview in MessageBubble */}
              <div className="w-1 h-8 rounded-full bg-ghost-400 shrink-0" />
              <div className="flex-1 min-w-0">
                {/* Original sender's name */}
                <div className="text-[11px] text-ghost-400 font-medium">{replyTo.senderName}</div>
                {/* Truncated content of the message being replied to */}
                <div className="text-[11px] text-white/40 truncate">{replyTo.content}</div>
              </div>
              {/* X button: clears replyTo, hides the reply bar */}
              <button onClick={() => setReplyTo(null)} className="shrink-0 text-white/30 hover:text-white/60 p-1">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* Message input form                                               */}
          {/* Contains: Timer button (TTL picker) + text input + Send button   */}
          {/* ---------------------------------------------------------------- */}
          <form onSubmit={handleSend} className="shrink-0 border-t border-white/5 px-3 py-2.5">
            <div className="flex items-center gap-2">

              {/* TTL picker toggle button + popover.
                  Clicking the Timer button opens a popover with TimerSelector.
                  TimerSelector calls onSelect() when a TTL is chosen, which
                  closes the popover (setShowTimerPicker(false)).
                  The selected TTL is stored in ChatContext.selectedTTL and
                  attached to each message when handleSend fires. */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowTimerPicker(!showTimerPicker)}
                  className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors shrink-0"
                  title="Message timer"
                >
                  <Timer className="w-4 h-4 text-white/40" />
                </button>

                {/* TTL picker popover: floats above the timer button */}
                {showTimerPicker && (
                  <div className="absolute bottom-full left-0 mb-2 z-30">
                    <div className="glass-card p-2 shadow-2xl">
                      {/* TimerSelector renders the TTL option buttons.
                          onSelect callback closes this popover after selection. */}
                      <TimerSelector onSelect={() => setShowTimerPicker(false)} />
                    </div>
                  </div>
                )}
              </div>

              {/* Message text input.
                  ref={inputRef}: focused programmatically when reply is set.
                  placeholder: changes to 'Reply to X...' when replyTo is active.
                  maxLength={2000}: client-side limit (server enforces 5000 chars).
                  autoFocus: keyboard opens immediately on mount. */}
              <input
                ref={inputRef}
                type="text"
                value={text}
                onChange={handleInputChange}
                placeholder={replyTo ? `Reply to ${replyTo.senderName}...` : 'Message...'}
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-ghost-500/50 transition-colors"
                maxLength={2000}
                autoFocus
              />

              {/* Send button: disabled when input is empty or socket is disconnected.
                  ghost-gradient background. active:scale-95 gives a press effect.
                  disabled:opacity-30 dims the button when sending is not possible. */}
              <button
                type="submit"
                disabled={!text.trim() || !connected}
                className="w-9 h-9 rounded-xl ghost-gradient flex items-center justify-center hover:opacity-90 active:scale-95 transition-all disabled:opacity-30 shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
        </main>

        {/* ---------------------------------------------------------------- */}
        {/* Sidebar: slide-in right panel with room info + user list          */}
        {/* Only rendered when showSidebar=true.                              */}
        {/* On mobile: fixed overlay with dark backdrop + slide animation.    */}
        {/* On desktop (md+): inline panel, no overlay backdrop.              */}
        {/* ---------------------------------------------------------------- */}
        {/* Sidebar outer wrapper: covers full screen on mobile for click-away.
            On md+: relative positioning lets it sit inline next to main. */}
        {showSidebar && (
          <div className="fixed inset-0 z-40 md:relative md:inset-auto" onClick={() => setShowSidebar(false)}>

            {/* Mobile backdrop: semi-transparent dark overlay behind sidebar.
                md:hidden: not shown on desktop (sidebar is inline there). */}
            <div className="absolute inset-0 bg-black/40 md:hidden" />

            {/* Sidebar panel.
                stopPropagation: prevents backdrop click-away from firing when
                  clicking inside the sidebar.
                animate-slide-in-right: CSS keyframe from index.css (slides from x=100%).
                md:shadow-none: on desktop, no shadow since it's inline. */}
            <aside
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-0 bottom-0 w-72 border-l border-white/5 bg-ghost-950 overflow-y-auto shadow-2xl md:relative md:w-64 md:shadow-none animate-slide-in-right"
            >
              <div className="p-4 space-y-5">

                {/* Sidebar header row: 'Room Info' title + mobile close button */}
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white/80">Room Info</h3>
                  {/* Close button: only visible on mobile (md:hidden) */}
                  <button onClick={() => setShowSidebar(false)} className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 md:hidden">
                    <X className="w-4 h-4 text-white/40" />
                  </button>
                </div>

                {/* Room details card: room code + copy/share + your name + encryption badge */}
                <div className="space-y-2 p-3 rounded-xl bg-white/5">
                  <div className="text-xs space-y-1.5">
                    <span className="text-white/40">Room Code</span>
                    {/* Room code row: large monospace code + copy button + share button */}
                    <div className="flex items-center gap-2">
                      {/* Large monospace room code display */}
                      <span className="font-mono text-lg text-ghost-300 tracking-wider flex-1">{roomCode}</span>

                      {/* Copy button: copies room link URL to clipboard */}
                      <button
                        onClick={copyRoomCode}
                        className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
                        title="Copy code"
                      >
                        <Copy className="w-3.5 h-3.5 text-white/50" />
                      </button>

                      {/* Share button: uses Web Share API (mobile) or clipboard fallback */}
                      <button
                        onClick={shareRoomCode}
                        className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
                        title="Share room"
                      >
                        <Share2 className="w-3.5 h-3.5 text-white/50" />
                      </button>
                    </div>
                    {/* Brief 'Copied!' confirmation shown for 2s after copy/share */}
                    {copied && <span className="text-green-400 text-[10px] font-medium">Copied!</span>}
                  </div>

                  {/* Your display name row. Crown emoji shows if current user is creator. */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/40">You</span>
                    <span className="text-white/70">{username} {isCreator && <span className="text-yellow-400">👑</span>}</span>
                  </div>

                  {/* Encryption type indicator */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/40">Encryption</span>
                    <span className="text-green-400/70 flex items-center gap-1"><Shield className="w-3 h-3" /> AES-GCM</span>
                  </div>
                </div>

                {/* JoinRequests: only renders content when isCreator=true and requests exist.
                    Shows pending join requests with Accept/Reject buttons. */}
                <JoinRequests />

                {/* UserList: list of all room members with presence dots.
                    Colors: green=active, grey=inactive (tab hidden), red=offline. */}
                <UserList />

                {/* Security info note: brief reminder about E2EE and no data storage */}
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 text-[11px] text-white/30 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-white/50">
                    <Shield className="w-3 h-3 text-ghost-400" />
                    <span className="font-medium">E2E Encrypted</span>
                  </div>
                  <p>Messages encrypted client-side. Server cannot read them. All data auto-deletes.</p>
                </div>

                {/* Leave room button: calls leaveRoom() which emits 'leave-room',
                    clears sessionStorage, and returns the user to the landing screen. */}
                <button
                  onClick={leaveRoom}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-colors"
                >
                  <LogOut className="w-4 h-4" /> Leave Room
                </button>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
