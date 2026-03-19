// =============================================================================
// Landing.jsx — Entry screen for Ghost Chat.
// Users choose between "Create Room" or "Join Room", then enter their display
// name (and room code for joining). Shows connection status, errors, and
// feature highlights (E2EE, auto-delete, no data stored).
// =============================================================================

import { useState } from 'react';
import { useChat } from '../context/ChatContext';
import { Ghost, ArrowRight, Plus, LogIn, Shield, Timer, Lock } from 'lucide-react';

export default function Landing() {
  const { createRoom, joinRoom, error, connected } = useChat();
  const [mode, setMode] = useState(null); // null | 'create' | 'join'
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  const handleCreate = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    createRoom(name.trim());
  };

  const handleJoin = (e) => {
    e.preventDefault();
    if (!name.trim() || !code.trim()) return;
    joinRoom(name.trim(), code.trim());
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-ghost-600/20 rounded-full blur-[128px]" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-ghost-400/10 rounded-full blur-[128px]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl ghost-gradient mb-4 shadow-lg shadow-ghost-600/30">
            <Ghost className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">
            Ghost <span className="text-ghost-400">Chat</span>
          </h1>
          <p className="text-white/50 mt-2 text-sm">
            Privacy-first ephemeral messaging
          </p>
        </div>

        {/* Connection status */}
        {!connected && (
          <div className="text-center mb-4 text-yellow-400/80 text-sm">
            Connecting to server...
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        {/* Mode selection */}
        {!mode && (
          <div className="space-y-3">
            <button
              onClick={() => setMode('create')}
              disabled={!connected}
              className="w-full glass-card p-5 flex items-center gap-4 hover:bg-white/10 transition-all group"
            >
              <div className="w-12 h-12 rounded-xl ghost-gradient flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <Plus className="w-6 h-6" />
              </div>
              <div className="text-left">
                <div className="font-semibold text-lg">Create Room</div>
                <div className="text-white/40 text-sm">Start a new private conversation</div>
              </div>
              <ArrowRight className="w-5 h-5 text-white/30 ml-auto group-hover:text-white/60 transition-colors" />
            </button>

            <button
              onClick={() => setMode('join')}
              disabled={!connected}
              className="w-full glass-card p-5 flex items-center gap-4 hover:bg-white/10 transition-all group"
            >
              <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <LogIn className="w-6 h-6 text-ghost-400" />
              </div>
              <div className="text-left">
                <div className="font-semibold text-lg">Join Room</div>
                <div className="text-white/40 text-sm">Enter with a secret room code</div>
              </div>
              <ArrowRight className="w-5 h-5 text-white/30 ml-auto group-hover:text-white/60 transition-colors" />
            </button>
          </div>
        )}

        {/* Create Room Form */}
        {mode === 'create' && (
          <form onSubmit={handleCreate} className="glass-card p-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <button
                type="button"
                onClick={() => setMode(null)}
                className="text-white/40 hover:text-white transition-colors text-sm"
              >
                &larr; Back
              </button>
              <h2 className="font-semibold text-lg">Create Room</h2>
            </div>
            <div>
              <label className="text-white/50 text-sm mb-1 block">Your name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter a display name"
                className="ghost-input"
                maxLength={20}
                autoFocus
              />
            </div>
            <button type="submit" disabled={!name.trim()} className="ghost-btn w-full">
              Create Private Room
            </button>
          </form>
        )}

        {/* Join Room Form */}
        {mode === 'join' && (
          <form onSubmit={handleJoin} className="glass-card p-6 space-y-4">
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
            <div>
              <label className="text-white/50 text-sm mb-1 block">Your name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter a display name"
                className="ghost-input"
                maxLength={20}
                autoFocus
              />
            </div>
            <div>
              <label className="text-white/50 text-sm mb-1 block">Room code</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Enter secret room code"
                className="ghost-input font-mono"
              />
            </div>
            <button
              type="submit"
              disabled={!name.trim() || !code.trim()}
              className="ghost-btn w-full"
            >
              Request to Join
            </button>
          </form>
        )}

        {/* Features */}
        <div className="mt-10 grid grid-cols-3 gap-4 text-center">
          <div className="space-y-2">
            <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center mx-auto">
              <Lock className="w-5 h-5 text-ghost-400" />
            </div>
            <p className="text-xs text-white/40">End-to-End Encrypted</p>
          </div>
          <div className="space-y-2">
            <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center mx-auto">
              <Timer className="w-5 h-5 text-ghost-400" />
            </div>
            <p className="text-xs text-white/40">Auto-Delete Messages</p>
          </div>
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
