import { useEffect, useState, useRef } from 'react';
import { Check, CheckCheck, Eye, Timer } from 'lucide-react';
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
  const { userId, markRead, setMessages } = useChat();
  const [fadeOut, setFadeOut] = useState(false);
  const [timeLeft, setTimeLeft] = useState(null);
  const timerRef = useRef(null);
  const seenRef = useRef(false);
  const bubbleRef = useRef(null);

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

  // Auto-delete timer
  useEffect(() => {
    const ttl = message.ttl;
    const ttlSec = TTL_SECONDS[ttl];

    if (ttl === 'after-seen') {
      // For "after seen" — start 10s countdown once read
      if (message.status === 'read' || (isOwn && seenRef.current)) {
        setTimeLeft(10);
      }
    } else if (ttlSec != null) {
      // Start countdown from when message was received
      const elapsed = Math.floor((Date.now() - message.receivedAt) / 1000);
      const remaining = Math.max(ttlSec - elapsed, 0);
      setTimeLeft(remaining);
    }
  }, [message.ttl, message.status, message.receivedAt, isOwn]);

  // Countdown
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
      setTimeLeft((t) => {
        if (t === null) return null;
        return Math.max(t - 1, 0);
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timeLeft, message.messageId, setMessages]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

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
      }`}
    >
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
          isOwn
            ? 'bg-ghost-600/30 rounded-br-md'
            : 'bg-white/5 rounded-bl-md'
        }`}
      >
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
      </div>
    </div>
  );
}
