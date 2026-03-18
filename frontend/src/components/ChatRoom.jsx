import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Copy, Ghost, Wifi, WifiOff, Menu, X, Shield, AlertTriangle } from 'lucide-react';
import { useChat } from '../context/ChatContext';
import MessageBubble from './MessageBubble';
import TypingIndicator from './TypingIndicator';
import TimerSelector from './TimerSelector';
import UserList from './UserList';
import JoinRequests from './JoinRequests';

export default function ChatRoom() {
  const {
    username,
    roomCode,
    userId,
    isCreator,
    messages,
    connected,
    reconnecting,
    error,
    sendMessage,
    startTyping,
    stopTyping,
  } = useChat();

  const [text, setText] = useState('');
  const [showSidebar, setShowSidebar] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(
    (e) => {
      e.preventDefault();
      if (!text.trim()) return;
      sendMessage(text.trim());
      setText('');
      stopTyping();
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

  return (
    <div className="h-screen flex flex-col bg-ghost-950">
      {/* Header */}
      <header className="shrink-0 border-b border-white/5 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl ghost-gradient flex items-center justify-center">
              <Ghost className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-semibold text-sm">Ghost Chat</h1>
                {connected ? (
                  <Wifi className="w-3 h-3 text-green-400" />
                ) : (
                  <WifiOff className="w-3 h-3 text-red-400" />
                )}
              </div>
              <button
                onClick={copyRoomCode}
                className="flex items-center gap-1 text-xs text-white/40 hover:text-white/60 transition-colors"
              >
                <span className="font-mono">{roomCode}</span>
                <Copy className="w-3 h-3" />
                {copied && <span className="text-green-400 text-[10px]">Copied!</span>}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowInfo(!showInfo)}
              className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
              title="Security info"
            >
              <Shield className="w-4 h-4 text-ghost-400" />
            </button>
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors md:hidden"
            >
              {showSidebar ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Reconnecting banner */}
        {reconnecting && (
          <div className="mt-2 text-xs text-yellow-400/70 text-center">
            Reconnecting...
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="mt-2 text-xs text-red-400 text-center bg-red-500/10 rounded-lg px-3 py-1.5">
            {error}
          </div>
        )}

        {/* Security info panel */}
        {showInfo && (
          <div className="mt-3 p-3 rounded-xl bg-white/5 border border-white/10 text-xs space-y-2">
            <div className="flex items-start gap-2">
              <Shield className="w-4 h-4 text-ghost-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-white/70">Messages are <strong className="text-white">end-to-end encrypted</strong> using AES-GCM. The server only relays encrypted data.</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-400/70 shrink-0 mt-0.5" />
              <div className="text-white/40">
                <p>Honest limitations:</p>
                <ul className="list-disc list-inside mt-1 space-y-0.5">
                  <li>Cannot prevent screenshots</li>
                  <li>Network metadata (IP) visible to ISP/hosting</li>
                  <li>Messages permanently lost after deletion</li>
                  <li>Requires trust in client-side encryption</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Messages area */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Timer selector */}
          <div className="shrink-0 border-b border-white/5 px-3 py-1.5">
            <TimerSelector />
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-white/20 space-y-3">
                <Ghost className="w-12 h-12" />
                <p className="text-sm">No messages yet. Start chatting!</p>
                <p className="text-xs">
                  Share room code <span className="font-mono text-ghost-400/50">{roomCode}</span> to invite others.
                </p>
              </div>
            )}
            {messages.map((msg) => (
              <MessageBubble key={msg.messageId} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Typing indicator */}
          <TypingIndicator />

          {/* Input */}
          <form onSubmit={handleSend} className="shrink-0 border-t border-white/5 px-4 py-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={text}
                onChange={handleInputChange}
                placeholder="Type a message..."
                className="flex-1 ghost-input !py-2.5 !rounded-xl"
                maxLength={2000}
                autoFocus
              />
              <button
                type="submit"
                disabled={!text.trim() || !connected}
                className="w-10 h-10 rounded-xl ghost-gradient flex items-center justify-center hover:opacity-90 active:scale-95 transition-all disabled:opacity-30"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </form>
        </main>

        {/* Sidebar (desktop always visible, mobile toggle) */}
        <aside
          className={`
            w-64 border-l border-white/5 p-4 space-y-6 overflow-y-auto bg-ghost-950
            ${showSidebar ? 'block absolute right-0 top-0 bottom-0 z-50 shadow-2xl' : 'hidden'}
            md:block md:relative md:shadow-none
          `}
        >
          {/* Mobile close button */}
          <div className="flex justify-end md:hidden">
            <button onClick={() => setShowSidebar(false)}>
              <X className="w-5 h-5 text-white/40" />
            </button>
          </div>

          <JoinRequests />
          <UserList />

          {/* Room info */}
          <div className="space-y-2 pt-4 border-t border-white/5">
            <p className="text-[10px] text-white/20 uppercase tracking-wider font-medium">Room Info</p>
            <div className="text-xs text-white/30 space-y-1">
              <p>Code: <span className="font-mono text-white/50">{roomCode}</span></p>
              <p>You: <span className="text-white/50">{username}</span></p>
              <p>Role: <span className="text-white/50">{isCreator ? 'Creator' : 'Member'}</span></p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
