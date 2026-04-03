// =============================================================================
// MessageBubble.jsx — Renders a single chat message bubble.
//
// Responsibilities:
//   1. Display message content, sender name, timestamp, and delivery status.
//   2. Show a reply preview bar if this message is a reply to another message.
//   3. Start an auto-delete countdown based on the message TTL:
//        - Timed TTLs (5s/15s/30s/1m/5m): countdown starts from receivedAt
//        - 'after-seen': countdown starts from 3s after the message is read
//   4. Emit 'message-read' via markRead() when the bubble scrolls into view
//      (IntersectionObserver at 50% threshold — only for messages from others).
//   5. Context menu via long-press (500ms), right-click, or double-click:
//        - Copy: copies message plaintext to clipboard
//        - Reply: sets replyTo in context (opens reply bar in ChatRoom)
//        - Delete: allowed only for sender or room creator
//   6. Swipe-right gesture on touch devices to trigger reply.
//   7. Quick reply button visible on hover (desktop, group-hover CSS).
//
// Props:
//   message — a full message object from ChatContext.messages array:
//     { messageId, senderId, senderName, content, status, ttl, ttlSeconds,
//       timestamp, receivedAt, replyTo? }
// =============================================================================

// useEffect: side effects — IntersectionObserver, TTL timers, cleanup
// useState:  local UI state — fade-out, countdown, menu visibility, swipe offset
// useRef:    stable references across renders — timers, dom node, touch tracking
// useCallback: memoized event handlers to prevent re-registration on each render
import { useEffect, useState, useRef, useCallback } from 'react';

// Check:     single checkmark — message sent to server
// CheckCheck: double checkmark — message delivered to recipient
// Eye:       eye icon — message has been read
// Timer:     countdown clock icon shown next to TTL counter
// Copy:      clipboard icon in context menu
// Reply:     reply arrow icon in context menu + quick-reply button
// Trash2:    delete icon in context menu
// X:         (imported but unused in render — kept for potential future use)
import { Check, CheckCheck, Eye, Timer, Copy, Reply, Trash2, X } from 'lucide-react';

// useChat provides: userId (current user), creatorId (room creator),
// markRead (emits message-read), setMessages, setReplyTo, deleteMessage
import { useChat } from '../context/ChatContext';

// TTL_SECONDS maps each TTL option string to its numeric duration in seconds.
// Used to compute the initial countdown value from (Date.now() - message.receivedAt).
// 'after-seen' is null because its countdown starts only AFTER the read receipt fires,
// not from receive time.
const TTL_SECONDS = {
  'after-seen': null, // countdown begins 0s after read (handled separately)
  '5s': 5,
  '15s': 15,
  '30s': 30,
  '1m': 60,
  '5m': 300,
};

// MessageBubble receives a single message object and renders it as a chat bubble.
export default function MessageBubble({ message }) {
  // userId:        current logged-in user's ID (to detect own vs other messages)
  // creatorId:     room creator's userId (creator can delete any message)
  // markRead:      function(messageId) — emits 'message-read' to server
  // setMessages:   not used directly here; deleteMessage uses it internally
  // setReplyTo:    sets the replyTo in ChatContext — opens reply bar in ChatRoom
  // deleteMessage: function(messageId, senderId) — emits 'delete-message' to server
  const { userId, creatorId, markRead, setMessages, setReplyTo, deleteMessage } = useChat();

  // fadeOut: true when TTL countdown reaches 0 — triggers CSS fade-out animation
  //          before the message is actually removed from the DOM
  const [fadeOut, setFadeOut] = useState(false);

  // timeLeft: remaining seconds on the TTL countdown.
  //   null    = countdown not started (message not yet read, or 'after-seen' waiting)
  //   > 0     = countdown active, shown as orange "Xs" badge on sender's view
  //   0       = expired — triggers fade and deletion
  const [timeLeft, setTimeLeft] = useState(null);

  // showMenu: whether the context menu (Copy/Reply/Delete) is currently visible
  const [showMenu, setShowMenu] = useState(false);

  // menuPos: { x, y } pixel position of the context menu on screen.
  //          Computed by openMenuAt() to prevent overflow off screen edges.
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  // swipeX: horizontal displacement (px) during a touch swipe gesture.
  //         Applied as CSS transform translateX to give visual feedback.
  //         Capped at 80px. When > 50px on release, triggers reply.
  const [swipeX, setSwipeX] = useState(0);

  // timerRef: holds the setTimeout handle for the 500ms fade-then-delete sequence.
  //           Cleared in cleanup to prevent calling deleteMessage on an unmounted component.
  const timerRef = useRef(null);

  // seenRef: tracks whether this bubble has already fired its read receipt.
  //          Prevents duplicate 'message-read' emissions if IntersectionObserver fires multiple times.
  const seenRef = useRef(false);

  // bubbleRef: DOM reference to the outermost bubble div.
  //            Passed to IntersectionObserver.observe() for scroll-based read detection.
  const bubbleRef = useRef(null);

  // longPressRef: holds the setTimeout handle for the 500ms long-press detection.
  //               Cleared on touchend/mouseleave/touchmove to cancel a false long-press.
  const longPressRef = useRef(null);

  // touchStartRef: records the initial touch position and timestamp.
  //                Used to compute swipe direction (dx vs dy) and duration.
  const touchStartRef = useRef({ x: 0, y: 0, time: 0 });

  // isOwn: true if this message was sent by the current user.
  //   - Own messages: right-aligned, ghost purple background, show status icon + TTL counter
  //   - Other messages: left-aligned, muted white background, show sender name
  const isOwn = message.senderId === userId;

  // ---------------------------------------------------------------------------
  // Effect 1: IntersectionObserver — fires 'message-read' when bubble enters viewport
  // ---------------------------------------------------------------------------
  // Only runs for messages from OTHER users (not own messages).
  // threshold: 0.5 means 50% of the bubble must be visible before firing.
  // seenRef prevents this from emitting the read receipt more than once,
  // even if the observer fires multiple times (e.g., scroll back and forth).
  useEffect(() => {
    if (isOwn || seenRef.current) return; // skip for own messages or already-seen

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !seenRef.current) {
          seenRef.current = true;          // mark as seen so we never fire again
          markRead(message.messageId);     // emit 'message-read' → server → sender sees 👁️
        }
      },
      { threshold: 0.5 } // fire when 50% of bubble is in viewport
    );

    if (bubbleRef.current) observer.observe(bubbleRef.current); // start observing
    return () => observer.disconnect(); // cleanup: disconnect observer on unmount
  }, [isOwn, markRead, message.messageId]);

  // ---------------------------------------------------------------------------
  // Effect 2: Initialise the TTL countdown (timeLeft)
  // ---------------------------------------------------------------------------
  // This runs whenever ttl, status, receivedAt, or isOwn changes.
  //
  // Two countdown modes:
  //   'after-seen': wait for status === 'read' (or isOwn + seenRef), then set 3s
  //   timed TTL: compute remaining = ttlSeconds - elapsed_since_received
  //
  // The 'elapsed' calculation ensures that if the component re-mounts mid-countdown
  // (e.g., after a reconnect), it picks up from the right remaining time instead
  // of resetting to the full TTL.
  useEffect(() => {
    const ttl = message.ttl;
    const ttlSec = TTL_SECONDS[ttl];

    if (ttl === 'after-seen') {
      // 'after-seen': start 3s countdown only once the recipient has read it
      // message.status === 'read': server confirmed the read receipt
      // isOwn && seenRef.current: for sender, treat IntersectionObserver as 'seen'
      if (message.status === 'read' || (isOwn && seenRef.current)) {
        setTimeLeft(3); // 3-second countdown after read
      }
    } else if (ttlSec != null) {
      // Timed TTL: calculate how much time has already elapsed since message arrived
      const elapsed = Math.floor((Date.now() - message.receivedAt) / 1000);
      const remaining = Math.max(ttlSec - elapsed, 0); // clamp to 0 (never negative)
      setTimeLeft(remaining);
    }
  }, [message.ttl, message.status, message.receivedAt, isOwn]);

  // ---------------------------------------------------------------------------
  // Effect 3: Countdown tick — decrements timeLeft every second
  // ---------------------------------------------------------------------------
  // When timeLeft reaches 0:
  //   1. Sets fadeOut=true — triggers CSS 'message-fade-out' animation (0.5s)
  //   2. After 500ms, calls deleteMessage() which emits 'delete-message' to server
  //      — server broadcasts 'message-deleted' to ALL users in the room
  //      — this is not just a local removal; every client deletes simultaneously
  //
  // Note: functional setState form (t => ...) avoids stale closure on timeLeft
  useEffect(() => {
    if (timeLeft === null) return; // countdown not started yet — do nothing

    if (timeLeft <= 0) {
      setFadeOut(true); // start CSS fade-out animation
      timerRef.current = setTimeout(() => {
        // After animation completes, emit delete to server — removes for ALL users
        deleteMessage(message.messageId);
      }, 500); // 500ms matches the CSS transition duration
      return; // no interval needed after expiry
    }

    // Set up a 1-second interval to decrement the countdown
    const interval = setInterval(() => {
      setTimeLeft((t) => (t === null ? null : Math.max(t - 1, 0)));
    }, 1000);

    return () => clearInterval(interval); // cleanup: stop interval on re-render or unmount
  }, [timeLeft, message.messageId, deleteMessage]);

  // ---------------------------------------------------------------------------
  // Effect 4: Cleanup on unmount
  // ---------------------------------------------------------------------------
  // Clears the delete-after-fade timeout if the component unmounts before it fires.
  // This prevents a React "Can't setState on unmounted component" warning and
  // prevents calling deleteMessage on a message that was already deleted externally.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current); // cancel pending delete
    };
  }, []);

  // ---------------------------------------------------------------------------
  // openMenuAt: computes a safe x,y position for the context menu
  // ---------------------------------------------------------------------------
  // Keeps the menu within the viewport on all edges.
  // menuW/menuH are approximate — exact size depends on whether 'Delete' shows.
  const openMenuAt = useCallback((clientX, clientY) => {
    const menuW = 160, menuH = 130; // approximate menu dimensions in px
    const vw = window.innerWidth, vh = window.innerHeight;
    let x = clientX, y = clientY;
    if (x + menuW > vw - 8) x = vw - menuW - 8; // prevent right-edge overflow
    if (x < 8) x = 8;                            // prevent left-edge overflow
    if (y + menuH > vh - 8) y = y - menuH;       // show above cursor if near bottom
    if (y < 8) y = 8;                            // prevent top-edge overflow
    setMenuPos({ x, y });
    setShowMenu(true);
  }, []);

  // ---------------------------------------------------------------------------
  // Long-press detection (works for both mouse and touch)
  // ---------------------------------------------------------------------------
  // startLongPress: starts a 500ms timer — if finger/button stays down for 500ms,
  //                 the context menu opens at the touch/click position.
  const startLongPress = useCallback((clientX, clientY) => {
    longPressRef.current = setTimeout(() => {
      openMenuAt(clientX, clientY); // open menu after 500ms hold
    }, 500);
  }, [openMenuAt]);

  // cancelLongPress: clears the long-press timer.
  //                  Called on touchmove (swipe), touchend, mouseleave, mouseup
  //                  to prevent the menu from opening if the press was short or moved.
  const cancelLongPress = useCallback(() => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Touch handlers for swipe-to-reply + long-press on mobile
  // ---------------------------------------------------------------------------

  // handleTouchStart: records initial touch position and starts long-press timer
  const handleTouchStart = useCallback((e) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    startLongPress(touch.clientX, touch.clientY); // begin 500ms long-press detection
  }, [startLongPress]);

  // handleTouchMove: detects horizontal swipe gesture.
  //   - Cancels long-press (user is swiping, not pressing)
  //   - Only activates for rightward swipe (dx > 10) with minimal vertical movement (dy < 30)
  //   - Moves bubble visually via swipeX state (CSS translateX)
  //   - Caps at 80px to prevent swiping too far off screen
  const handleTouchMove = useCallback((e) => {
    cancelLongPress(); // movement cancels long-press
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartRef.current.x;  // horizontal delta
    const dy = Math.abs(touch.clientY - touchStartRef.current.y); // vertical delta

    if (dx > 10 && dy < 30) {
      setSwipeX(Math.min(dx, 80)); // apply horizontal displacement, capped at 80px
    }
  }, [cancelLongPress]);

  // handleTouchEnd: checks if swipe was far enough to trigger reply.
  //   - Threshold: 50px rightward swipe triggers setReplyTo
  //   - Always resets swipeX to 0 so the bubble springs back
  const handleTouchEnd = useCallback(() => {
    cancelLongPress();
    if (swipeX > 50) {
      setReplyTo(message); // open reply bar in ChatRoom with this message as replyTo
    }
    setSwipeX(0); // spring back to original position
  }, [cancelLongPress, swipeX, setReplyTo, message]);

  // ---------------------------------------------------------------------------
  // Context menu action handlers
  // ---------------------------------------------------------------------------

  // handleCopy: copies the decrypted message text to clipboard
  // message.content is the plaintext (already decrypted by ChatContext before storing)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content || '');
    setShowMenu(false); // close menu after action
  }, [message.content]);

  // handleReply: sets this message as the reply target in ChatContext
  // ChatRoom watches replyTo and shows the reply bar when it's non-null
  const handleReply = useCallback(() => {
    setReplyTo(message);
    setShowMenu(false);
  }, [setReplyTo, message]);

  // handleDelete: emits 'delete-message' with both messageId and senderId
  // The server validates that the caller is either the sender or the room creator.
  // Passing senderId allows the server to do a quick identity check.
  const handleDelete = useCallback(() => {
    deleteMessage(message.messageId, message.senderId);
    setShowMenu(false);
  }, [deleteMessage, message.messageId, message.senderId]);

  // canDelete: determines whether the Delete option appears in the context menu.
  // Client-side check: isOwn (sent by me) OR I am the room creator.
  // Server also validates this — this is just for UI (don't show button if not allowed).
  const canDelete = isOwn || userId === creatorId;

  // handleDoubleClick: opens the context menu on desktop double-click
  // preventDefault stops text selection from triggering during double-click
  const handleDoubleClick = useCallback((e) => {
    e.preventDefault();
    openMenuAt(e.clientX, e.clientY);
  }, [openMenuAt]);

  // ---------------------------------------------------------------------------
  // Status icon: reflects message delivery progression
  // ---------------------------------------------------------------------------
  // sent      → single grey check    (server received it)
  // delivered → double purple check  (recipient's client received it)
  // read      → eye icon in purple   (recipient saw it / IntersectionObserver fired)
  // Only shown on the sender's own messages (right side)
  const statusIcon =
    message.status === 'read' ? (
      <Eye className="w-3 h-3 text-ghost-400" />          // eye = read
    ) : message.status === 'delivered' ? (
      <CheckCheck className="w-3 h-3 text-ghost-400" />   // double check = delivered
    ) : (
      <Check className="w-3 h-3 text-white/30" />         // single check = sent
    );

  // Format timestamp: display as HH:MM (locale-aware, 12 or 24-hour based on OS)
  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    // Fragment wrapper: the bubble div and the context menu portal are siblings
    <>
      {/* -------------------------------------------------------------------- */}
      {/* Outer bubble row — flex row aligned left or right based on isOwn       */}
      {/* -------------------------------------------------------------------- */}
      {/*
        Outer bubble row:
        - ref={bubbleRef}: attached so IntersectionObserver can watch scroll visibility
        - justify-end / justify-start: right-align own messages, left-align others
        - message-fade-out: CSS animation that fades + shrinks bubble before removal
        - group: Tailwind group class enables group-hover on child quick-reply button
        - style transform translateX: drives swipe-to-reply horizontal movement
        - transition 0.2s: smooth spring-back after swipe release (none during active swipe)
        - onTouchStart/Move/End: mobile swipe-to-reply + long-press detection
        - onMouseDown/Up/Leave: desktop long-press detection (500ms hold opens menu)
        - onDoubleClick: alternative menu trigger on desktop
        - onContextMenu: right-click menu (prevents default browser context menu)
      */}
      <div
        ref={bubbleRef}
        className={`flex ${
          isOwn ? 'justify-end' : 'justify-start'
        } ${
          fadeOut ? 'message-fade-out' : ''
        } relative group select-none`}
        style={{
          transform: `translateX(${swipeX}px)`,
          transition: swipeX === 0 ? 'transform 0.2s' : 'none',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={(e) => startLongPress(e.clientX, e.clientY)}
        onMouseUp={cancelLongPress}
        onMouseLeave={cancelLongPress}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => { e.preventDefault(); openMenuAt(e.clientX, e.clientY); }}
      >
        {/* Swipe-reply arrow indicator: appears when swipe offset exceeds 20px.
            Gives visual feedback that a rightward swipe is in progress (reply gesture). */}
        {swipeX > 20 && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-2 text-ghost-400">
            <Reply className="w-5 h-5" />
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Inner bubble box — contains all message content                  */}
        {/* Own messages:   ghost purple tint, squared bottom-right corner   */}
        {/* Other messages: white tint, squared bottom-left corner            */}
        {/* max-w-[75%]: prevent bubble from spanning full message area width */}
        {/* ---------------------------------------------------------------- */}
        <div
          className={`max-w-[75%] rounded-2xl px-4 py-2.5 relative ${
            isOwn
              ? 'bg-ghost-600/30 rounded-br-md'  // sender: ghost purple, squared bottom-right
              : 'bg-white/5 rounded-bl-md'         // receiver: muted white, squared bottom-left
          }`}
        >
          {/* -------------------------------------------------------------- */}
          {/* Reply preview — shown only if this message is replying to another */}
          {/* Contains the original sender's name and a truncated quote of text */}
          {/* -------------------------------------------------------------- */}
          {message.replyTo && (
            <div className="mb-2 px-3 py-1.5 rounded-lg bg-white/5 border-l-2 border-ghost-400 text-xs">
              {/* Original sender's name in ghost purple */}
              <div className="text-ghost-400 font-medium">{message.replyTo.senderName}</div>
              {/* Truncated original message content */}
              <div className="text-white/40 truncate">{message.replyTo.content}</div>
            </div>
          )}

          {/* Sender name — only shown for messages from others (not own messages) */}
          {!isOwn && (
            <div className="text-xs text-ghost-400 font-medium mb-0.5">
              {message.senderName}  {/* display name of the person who sent this */}
            </div>
          )}

          {/* Message plaintext — decrypted by ChatContext before being stored in messages[] */}
          {/* break-words: wraps long words/URLs. whitespace-pre-wrap: preserves newlines. */}
          {/* select-text: overrides parent's select-none so text can be selected/copied */}
          <div className="text-sm text-white/90 break-words whitespace-pre-wrap select-text">
            {message.content}
          </div>

          {/* -------------------------------------------------------------- */}
          {/* Message footer row: TTL countdown + timestamp + status icon     */}
          {/* -------------------------------------------------------------- */}
          <div className="flex items-center justify-end gap-1.5 mt-1">

            {/* TTL countdown badge — only visible to the SENDER (isOwn).
                Hidden from recipients so they don't see when it will vanish. */}
            {/* TTL seconds remaining e.g. '42s', '5s' — clock icon + number */}
            {isOwn && timeLeft !== null && timeLeft > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-orange-400/60">
                <Timer className="w-2.5 h-2.5" />
                {timeLeft}s
              </span>
            )}

            {/* Send timestamp in HH:MM format */}
            <span className="text-[10px] text-white/25">{time}</span>

            {/* Delivery status icon — only on own messages (shows receipt to sender) */}
            {isOwn && statusIcon}
          </div>

          {/* -------------------------------------------------------------- */}
          {/* Quick reply button — shown on hover (desktop only)              */}
          {/* hidden by default, visible via Tailwind group-hover:flex class   */}
          {/* Positioned to the left of the bubble, vertically centered        */}
          {/* -------------------------------------------------------------- */}
          <button
            onClick={handleReply}
            className="absolute -left-8 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/10 items-center justify-center hover:bg-white/20 transition-all hidden group-hover:flex"
            title="Reply"
          >
            <Reply className="w-3 h-3 text-white/60" />
          </button>
        </div>
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* Context menu — rendered as a fixed-position overlay (z-100)           */}
      {/* The outer div covers the full screen and acts as a click-away backdrop */}
      {/* Clicking anywhere outside the menu div dismisses it                   */}
      {/* -------------------------------------------------------------------- */}
      {showMenu && (
        <div className="fixed inset-0 z-[100]" onClick={() => setShowMenu(false)}>

          {/* Dimmed, slightly blurred backdrop behind the menu */}
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />

          {/* Menu panel — positioned at menuPos (computed by openMenuAt to avoid overflow) */}
          {/* animate-scale-in: scale 0.9→1.0 + fade-in from index.css keyframe */}
          <div
            className="absolute bg-ghost-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden min-w-[150px] animate-scale-in"
            style={{ left: menuPos.x, top: menuPos.y }}
            onClick={(e) => e.stopPropagation()} // prevent backdrop click-away when clicking menu
          >
            {/* Copy option — always available */}
            <button
              onClick={handleCopy}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors"
            >
              <Copy className="w-4 h-4" /> Copy
            </button>

            {/* Reply option — always available */}
            <button
              onClick={handleReply}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors"
            >
              <Reply className="w-4 h-4" /> Reply
            </button>

            {/* Delete option — only shown if canDelete (sender or room creator) */}
            {canDelete && (
              <button
                onClick={handleDelete}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
