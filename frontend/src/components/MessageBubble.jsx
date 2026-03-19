// =============================================================================
// MessageBubble.jsx — Renders a single chat message with:
// - Reply preview (if message is a reply to another)
// - Long-press context menu (Copy / Reply / Delete)
// - Swipe-right to reply gesture (touch devices)
// - Auto-delete countdown based on TTL
// - IntersectionObserver-based read receipts
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
  const { userId, markRead, setMessages, setReplyTo, deleteMessage } = useChat();
  const [fadeOut, setFadeOut] = useState(false);
  const [timeLeft, setTimeLeft] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
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
        setTimeLeft(10);
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
        setMessages((prev) => prev.filter((m) => m.messageId !== message.messageId));
      }, 500);
      return;
    }

    const interval = setInterval(() => {
      setTimeLeft((t) => (t === null ? null : Math.max(t - 1, 0)));
    }, 1000);

    return () => clearInterval(interval);
  }, [timeLeft, message.messageId, setMessages]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // ---- Long press handlers (for both touch and mouse) ----
  const startLongPress = useCallback(() => {
    longPressRef.current = setTimeout(() => {
      setShowMenu(true);
    }, 500);
  }, []);

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
    startLongPress();
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

  const handleDelete = useCallback(() => {
    deleteMessage(message.messageId);
    setShowMenu(false);
  }, [deleteMessage, message.messageId]);

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const close = () => setShowMenu(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [showMenu]);

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
    <div
      ref={bubbleRef}
      className={`flex ${isOwn ? 'justify-end' : 'justify-start'} ${
        fadeOut ? 'message-fade-out' : ''
      } relative group`}
      style={{ transform: `translateX(${swipeX}px)`, transition: swipeX === 0 ? 'transform 0.2s' : 'none' }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={startLongPress}
      onMouseUp={cancelLongPress}
      onMouseLeave={cancelLongPress}
      onContextMenu={(e) => { e.preventDefault(); setShowMenu(true); }}
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
        <div className="text-sm text-white/90 break-words whitespace-pre-wrap">
          {message.content}
        </div>
        <div className="flex items-center justify-end gap-1.5 mt-1">
          {timeLeft !== null && timeLeft > 0 && (
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

      {/* Long-press context menu */}
      {showMenu && (
        <div
          className={`absolute z-50 ${isOwn ? 'right-0' : 'left-0'} top-full mt-1 bg-ghost-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden min-w-[140px]`}
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
          <button
            onClick={handleDelete}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}
