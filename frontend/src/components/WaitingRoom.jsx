import { Ghost, Loader2 } from 'lucide-react';
import { useChat } from '../context/ChatContext';

export default function WaitingRoom() {
  const { username, roomCode } = useChat();

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="glass-card p-8 max-w-sm w-full text-center space-y-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl ghost-gradient mx-auto">
          <Ghost className="w-8 h-8 text-white" />
        </div>

        <div>
          <h2 className="text-xl font-bold mb-1">Waiting for approval</h2>
          <p className="text-white/50 text-sm">
            <span className="text-white font-medium">{username}</span>, your request to join room{' '}
            <span className="font-mono text-ghost-400">{roomCode}</span> has been sent.
          </p>
        </div>

        <div className="flex items-center justify-center gap-2 text-ghost-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Waiting for the room creator to accept...</span>
        </div>

        <p className="text-white/30 text-xs">
          This page will update automatically once your request is approved.
        </p>
      </div>
    </div>
  );
}
