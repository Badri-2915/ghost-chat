// =============================================================================
// ChatRoom.jsx — Main chat interface component.
// Includes sticky header with room info, message area with auto-scroll, reply
// bar, typing indicator, message input with inline TTL picker, panic delete,
// sidebar with users/join requests, disconnect overlay, and toast notifications.
// =============================================================================

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Copy, Ghost, Wifi, WifiOff, Users, X, Shield, AlertTriangle, Bomb, Reply, LogOut, ChevronDown, Timer, Share2 } from 'lucide-react';
import { useChat } from '../context/ChatContext';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import TimerSelector from './TimerSelector';
import UserList from './UserList';
import JoinRequests from './JoinRequests';
import ToastContainer from './ToastContainer';

export default function ChatRoom() {
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

  const [text, setText] = useState('');
  const [showSidebar, setShowSidebar] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmPanic, setConfirmPanic] = useState(false);
  const [showTimerPicker, setShowTimerPicker] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [newMsgCount, setNewMsgCount] = useState(0);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const inputRef = useRef(null);

  const userCount = Object.keys(users).length;

  // Auto-scroll to bottom on new messages (only if user is near bottom)
  useEffect(() => {
    if (atBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setNewMsgCount(0);
    } else if (messages.length > 0) {
      setNewMsgCount((prev) => prev + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Track if user is scrolled to bottom
  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const threshold = 80;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setAtBottom(isAtBottom);
    if (isAtBottom) setNewMsgCount(0);
  }, []);

  // Focus input when reply is set
  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setAtBottom(true);
    setNewMsgCount(0);
  }, []);

  const handleSend = useCallback(
    (e) => {
      e.preventDefault();
      if (!text.trim()) return;
      sendMessage(text.trim());
      setText('');
      stopTyping();
      setAtBottom(true);
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
    },
    [text, sendMessage, stopTyping]
  );

  const handleInputChange = useCallback(
    (e) => {
      setText(e.target.value);
      startTyping();
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        stopTyping();
      }, 2000);
    },
    [startTyping, stopTyping]
  );

  const copyRoomCode = useCallback(() => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [roomCode]);

  const shareRoomCode = useCallback(async () => {
    const shareData = {
      title: 'Ghost Chat',
      text: `Join my Ghost Chat room! Code: ${roomCode}`,
      url: window.location.origin,
    };
    try {
      if (navigator.share && navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
      } else {
        // Fallback: copy to clipboard
        await navigator.clipboard.writeText(`Join my Ghost Chat room! Code: ${roomCode} — ${window.location.origin}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (e) {
      // User cancelled share or error
    }
  }, [roomCode]);

  const handlePanicDelete = useCallback(() => {
    if (!confirmPanic) {
      setConfirmPanic(true);
      setTimeout(() => setConfirmPanic(false), 3000);
      return;
    }
    panicDelete();
    setConfirmPanic(false);
  }, [confirmPanic, panicDelete]);

  // Close sidebar on mobile when clicking outside
  useEffect(() => {
    if (!showSidebar) return;
    const close = (e) => {
      if (e.target.closest('aside')) return;
      setShowSidebar(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [showSidebar]);

  return (
    <div className="h-screen flex flex-col bg-ghost-950">
      {/* Toast notifications */}
      <ToastContainer />

      {/* Disconnect overlay */}
      {!connected && (
        <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center">
          <div className="glass-card p-6 max-w-xs w-full mx-4 text-center space-y-3">
            <WifiOff className="w-8 h-8 text-red-400 mx-auto" />
            <h3 className="font-semibold text-base">Connection Lost</h3>
            <p className="text-white/50 text-sm">
              {reconnecting ? 'Reconnecting to server...' : 'Waiting for network...'}
            </p>
            <div className="flex justify-center">
              <div className="w-5 h-5 border-2 border-ghost-400 border-t-transparent rounded-full animate-spin" />
            </div>
          </div>
        </div>
      )}

      {/* Header — sticky, compact */}
      <header className="shrink-0 border-b border-white/5 bg-ghost-950/95 backdrop-blur-sm z-20">
        <div className="flex items-center justify-between px-3 py-2.5">
          {/* Left: logo + room info */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg ghost-gradient flex items-center justify-center shrink-0">
              <Ghost className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={copyRoomCode}
                  className="flex items-center gap-1 text-xs font-mono text-white/60 hover:text-white/90 transition-colors"
                >
                  {roomCode}
                  <Copy className="w-3 h-3" />
                </button>
                {copied && <span className="text-green-400 text-[10px] font-medium">Copied!</span>}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-white/30">
                <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
                <span>{connected ? 'Encrypted' : 'Offline'}</span>
                <span className="text-white/15">·</span>
                <span>{userCount} {userCount === 1 ? 'user' : 'users'}</span>
              </div>
            </div>
          </div>

          {/* Right: action buttons */}
          <div className="flex items-center gap-1.5">
            {/* Panic delete */}
            <button
              onClick={handlePanicDelete}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                confirmPanic
                  ? 'bg-red-500/30 ring-1 ring-red-400 animate-pulse'
                  : 'bg-white/5 hover:bg-red-500/20'
              }`}
              title={confirmPanic ? 'Click again to confirm' : 'Delete all messages'}
            >
              <Bomb className={`w-3.5 h-3.5 ${confirmPanic ? 'text-red-400' : 'text-white/40'}`} />
            </button>
            {/* Users / sidebar toggle */}
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

        {/* Error banner */}
        {error && (
          <div className="px-3 pb-2">
            <div className="text-xs text-red-400 text-center bg-red-500/10 rounded-lg px-3 py-1.5">
              {error}
            </div>
          </div>
        )}
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Messages area */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Messages */}
          <div
            ref={messagesContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5 sm:px-4"
          >
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-white/20 space-y-3">
                <Ghost className="w-10 h-10" />
                <p className="text-sm">No messages yet</p>
                <button onClick={copyRoomCode} className="text-xs text-ghost-400/50 hover:text-ghost-400 transition-colors">
                  Share code <span className="font-mono">{roomCode}</span> to invite others
                </button>
              </div>
            )}
            {messages.map((msg) => (
              <MessageBubble key={msg.messageId} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Scroll-to-bottom / New messages indicator */}
          {!atBottom && messages.length > 0 && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-28 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-ghost-600/90 backdrop-blur-sm shadow-lg hover:bg-ghost-600 transition-colors z-10 text-xs font-medium"
            >
              {newMsgCount > 0 ? (
                <>{newMsgCount} new {newMsgCount === 1 ? 'message' : 'messages'} <ChevronDown className="w-3.5 h-3.5" /></>
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          {/* Typing indicator */}
          <TypingIndicator />

          {/* Reply bar */}
          {replyTo && (
            <div className="shrink-0 border-t border-white/5 px-3 py-2 flex items-center gap-2 bg-ghost-900/50">
              <div className="w-1 h-8 rounded-full bg-ghost-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-ghost-400 font-medium">{replyTo.senderName}</div>
                <div className="text-[11px] text-white/40 truncate">{replyTo.content}</div>
              </div>
              <button onClick={() => setReplyTo(null)} className="shrink-0 text-white/30 hover:text-white/60 p-1">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Input area with inline TTL */}
          <form onSubmit={handleSend} className="shrink-0 border-t border-white/5 px-3 py-2.5">
            <div className="flex items-center gap-2">
              {/* TTL toggle */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowTimerPicker(!showTimerPicker)}
                  className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors shrink-0"
                  title="Message timer"
                >
                  <Timer className="w-4 h-4 text-white/40" />
                </button>
                {showTimerPicker && (
                  <div className="absolute bottom-full left-0 mb-2 z-30">
                    <div className="glass-card p-2 shadow-2xl">
                      <TimerSelector onSelect={() => setShowTimerPicker(false)} />
                    </div>
                  </div>
                )}
              </div>
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

        {/* Sidebar — slides in from right */}
        {showSidebar && (
          <div className="fixed inset-0 z-40 md:relative md:inset-auto" onClick={() => setShowSidebar(false)}>
            {/* Backdrop (mobile only) */}
            <div className="absolute inset-0 bg-black/40 md:hidden" />
            <aside
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-0 bottom-0 w-72 border-l border-white/5 bg-ghost-950 overflow-y-auto shadow-2xl md:relative md:w-64 md:shadow-none animate-slide-in-right"
            >
              <div className="p-4 space-y-5">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white/80">Room Info</h3>
                  <button onClick={() => setShowSidebar(false)} className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 md:hidden">
                    <X className="w-4 h-4 text-white/40" />
                  </button>
                </div>

                {/* Room details */}
                <div className="space-y-2 p-3 rounded-xl bg-white/5">
                  <div className="text-xs space-y-1.5">
                    <span className="text-white/40">Room Code</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-lg text-ghost-300 tracking-wider flex-1">{roomCode}</span>
                      <button
                        onClick={copyRoomCode}
                        className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
                        title="Copy code"
                      >
                        <Copy className="w-3.5 h-3.5 text-white/50" />
                      </button>
                      <button
                        onClick={shareRoomCode}
                        className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
                        title="Share room"
                      >
                        <Share2 className="w-3.5 h-3.5 text-white/50" />
                      </button>
                    </div>
                    {copied && <span className="text-green-400 text-[10px] font-medium">Copied!</span>}
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/40">You</span>
                    <span className="text-white/70">{username} {isCreator && <span className="text-yellow-400">👑</span>}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-white/40">Encryption</span>
                    <span className="text-green-400/70 flex items-center gap-1"><Shield className="w-3 h-3" /> AES-GCM</span>
                  </div>
                </div>

                <JoinRequests />
                <UserList />

                {/* Security note */}
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 text-[11px] text-white/30 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-white/50">
                    <Shield className="w-3 h-3 text-ghost-400" /> <span className="font-medium">E2E Encrypted</span>
                  </div>
                  <p>Messages encrypted client-side. Server cannot read them. All data auto-deletes.</p>
                </div>

                {/* Leave room */}
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
