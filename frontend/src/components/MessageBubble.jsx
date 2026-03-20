// =============================================================================
// MessageBubble.jsx — Renders a single chat message with:
// - Reply preview (if message is a reply to another)
// - Long-press / double-click context menu (Copy / Reply / Delete)
// - Swipe-right to reply gesture (touch devices)
// - Auto-delete countdown based on TTL (timer visible to sender only)
// - IntersectionObserver-based read receipts
// - Delete permission: only sender or room creator can delete
// =============================================================================

import { useEffect, useState, useRef, useCallback } from 'react';
import { Check, CheckCheck, Eye, Timer, Copy, Reply, Trash2, X } from 'lucide-react';
import { useChat } from '../context/ChatContext';

const TTL_SECONDS = {
  'after-seen': null,
  '5s': 5,
  '15s': 15,
  '30s': 30,
  '1m': 60,
  '5m': 300,
};

export default function MessageBubble({ message }) {
  const { userId, creatorId, markRead, setMessages, setReplyTo, deleteMessage } = useChat();
  const [fadeOut, setFadeOut] = useState(false);
  const [timeLeft, setTimeLeft] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [swipeX, setSwipeX] = useState(0);
  const timerRef = useRef(null);
  const seenRef = useRef(false);
  const bubbleRef = useRef(null);
  const longPressRef = useRef(null);
  const touchStartRef = useRef({ x: 0, y: 0, time: 0 });

  const isOwn = message.senderId === userId;

  // Mark as read when visible (for non-own messages)
  useEffect(() => {
    if (isOwn || seenRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !seenRef.current) {
          seenRef.current = true;
          markRead(message.messageId);
        }
      },
      { threshold: 0.5 }
    );

    if (bubbleRef.current) observer.observe(bubbleRef.current);
    return () => observer.disconnect();
  }, [isOwn, markRead, message.messageId]);

  // Auto-delete timer logic
  useEffect(() => {
    const ttl = message.ttl;
    const ttlSec = TTL_SECONDS[ttl];

    if (ttl === 'after-seen') {
      if (message.status === 'read' || (isOwn && seenRef.current)) {
        setTimeLeft(3);
      }
    } else if (ttlSec != null) {
      const elapsed = Math.floor((Date.now() - message.receivedAt) / 1000);
      const remaining = Math.max(ttlSec - elapsed, 0);
      setTimeLeft(remaining);
    }
  }, [message.ttl, message.status, message.receivedAt, isOwn]);

  // Countdown tick
  useEffect(() => {
    if (timeLeft === null) return;

    if (timeLeft <= 0) {
      setFadeOut(true);
      timerRef.current = setTimeout(() => {
        // Broadcast delete to ALL users via server (not just local)
        deleteMessage(message.messageId);
      }, 500);
      return;
    }

    const interval = setInterval(() => {
      setTimeLeft((t) => (t === null ? null : Math.max(t - 1, 0)));
    }, 1000);

    return () => clearInterval(interval);
  }, [timeLeft, message.messageId, deleteMessage]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // ---- Menu positioning helper ----
  const openMenuAt = useCallback((clientX, clientY) => {
    // Menu dimensions (approximate)
    const menuW = 160, menuH = 130;
    const vw = window.innerWidth, vh = window.innerHeight;
    let x = clientX, y = clientY;
    // Prevent overflow right
    if (x + menuW > vw - 8) x = vw - menuW - 8;
    // Prevent overflow left
    if (x < 8) x = 8;
    // Prevent overflow bottom — show above if needed
    if (y + menuH > vh - 8) y = y - menuH;
    if (y < 8) y = 8;
    setMenuPos({ x, y });
    setShowMenu(true);
  }, []);

  // ---- Long press handlers (for both touch and mouse) ----
  const startLongPress = useCallback((clientX, clientY) => {
    longPressRef.current = setTimeout(() => {
      openMenuAt(clientX, clientY);
    }, 500);
  }, [openMenuAt]);

  const cancelLongPress = useCallback(() => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);

  // ---- Swipe-to-reply (touch devices) ----
  const handleTouchStart = useCallback((e) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    startLongPress(touch.clientX, touch.clientY);
  }, [startLongPress]);

  const handleTouchMove = useCallback((e) => {
    cancelLongPress();
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = Math.abs(touch.clientY - touchStartRef.current.y);

    // Only allow horizontal swipe (right direction for reply)
    if (dx > 10 && dy < 30) {
      setSwipeX(Math.min(dx, 80)); // cap at 80px
    }
  }, [cancelLongPress]);

  const handleTouchEnd = useCallback(() => {
    cancelLongPress();
    if (swipeX > 50) {
      // Trigger reply
      setReplyTo(message);
    }
    setSwipeX(0);
  }, [cancelLongPress, swipeX, setReplyTo, message]);

  // ---- Context menu actions ----
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content || '');
    setShowMenu(false);
  }, [message.content]);

  const handleReply = useCallback(() => {
    setReplyTo(message);
    setShowMenu(false);
  }, [setReplyTo, message]);

  // Delete: pass senderId for server-side permission check
  const handleDelete = useCallback(() => {
    deleteMessage(message.messageId, message.senderId);
    setShowMenu(false);
  }, [deleteMessage, message.messageId, message.senderId]);

  // Permission: only sender or room creator can delete
  const canDelete = isOwn || userId === creatorId;

  // Double-click to open menu (desktop)
  const handleDoubleClick = useCallback((e) => {
    e.preventDefault();
    openMenuAt(e.clientX, e.clientY);
  }, [openMenuAt]);

  // ---- Status icon (sent/delivered/read) ----
  const statusIcon =
    message.status === 'read' ? (
      <Eye className="w-3 h-3 text-ghost-400" />
    ) : message.status === 'delivered' ? (
      <CheckCheck className="w-3 h-3 text-ghost-400" />
    ) : (
      <Check className="w-3 h-3 text-white/30" />
    );

  const time = new Date(message.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <>
      <div
        ref={bubbleRef}
        className={`flex ${isOwn ? 'justify-end' : 'justify-start'} ${
          fadeOut ? 'message-fade-out' : ''
        } relative group select-none`}
        style={{ transform: `translateX(${swipeX}px)`, transition: swipeX === 0 ? 'transform 0.2s' : 'none' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={(e) => startLongPress(e.clientX, e.clientY)}
        onMouseUp={cancelLongPress}
        onMouseLeave={cancelLongPress}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => { e.preventDefault(); openMenuAt(e.clientX, e.clientY); }}
      >
        {/* Swipe reply indicator */}
        {swipeX > 20 && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-2 text-ghost-400">
            <Reply className="w-5 h-5" />
          </div>
        )}

        <div
          className={`max-w-[75%] rounded-2xl px-4 py-2.5 relative ${
            isOwn
              ? 'bg-ghost-600/30 rounded-br-md'
              : 'bg-white/5 rounded-bl-md'
          }`}
        >
          {/* Reply preview (if this message is a reply to another) */}
          {message.replyTo && (
            <div className="mb-2 px-3 py-1.5 rounded-lg bg-white/5 border-l-2 border-ghost-400 text-xs">
              <div className="text-ghost-400 font-medium">{message.replyTo.senderName}</div>
              <div className="text-white/40 truncate">{message.replyTo.content}</div>
            </div>
          )}

          {!isOwn && (
            <div className="text-xs text-ghost-400 font-medium mb-0.5">
              {message.senderName}
            </div>
          )}
          <div className="text-sm text-white/90 break-words whitespace-pre-wrap select-text">
            {message.content}
          </div>
          <div className="flex items-center justify-end gap-1.5 mt-1">
            {isOwn && timeLeft !== null && timeLeft > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-orange-400/60">
                <Timer className="w-2.5 h-2.5" />
                {timeLeft}s
              </span>
            )}
            <span className="text-[10px] text-white/25">{time}</span>
            {isOwn && statusIcon}
          </div>

          {/* Quick reply button on hover (desktop) */}
          <button
            onClick={handleReply}
            className="absolute -left-8 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/10 items-center justify-center hover:bg-white/20 transition-all hidden group-hover:flex"
            title="Reply"
          >
            <Reply className="w-3 h-3 text-white/60" />
          </button>
        </div>
      </div>

      {/* Context menu — fixed position portal with backdrop */}
      {showMenu && (
        <div className="fixed inset-0 z-[100]" onClick={() => setShowMenu(false)}>
          {/* Dimmed backdrop */}
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
          {/* Menu */}
          <div
            className="absolute bg-ghost-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden min-w-[150px] animate-scale-in"
            style={{ left: menuPos.x, top: menuPos.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleCopy}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors"
            >
              <Copy className="w-4 h-4" /> Copy
            </button>
            <button
              onClick={handleReply}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 transition-colors"
            >
              <Reply className="w-4 h-4" /> Reply
            </button>
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
