// =============================================================================
// WaitingRoom.jsx — Shown while a user waits for the room creator to approve
// their join request. Displays a spinner and auto-updates on approval/rejection.
// =============================================================================

// Ghost: logo icon displayed in the waiting card
// Loader2: animated spinner icon (CSS animation via Tailwind 'animate-spin')
import { Ghost, Loader2 } from 'lucide-react';

// useChat: access username and roomCode from global state (set when join-request was submitted)
import { useChat } from '../context/ChatContext';

// WaitingRoom renders a centered card that is shown while:
//   1. The user has submitted a join request (emitted 'join-request' to server)
//   2. The server has replied with 'join-requested' (setting screen = 'waiting')
//   3. The user is waiting for the creator to approve or reject
// This screen auto-transitions when 'join-approved' or 'join-rejected' arrives via socket.
export default function WaitingRoom() {
  // username and roomCode were set in ChatContext when the join request was submitted
  const { username, roomCode } = useChat();

  return (
    // Full-screen centered layout with padding for mobile
    <div className="min-h-screen flex items-center justify-center px-4">
      {/* Glass-morphism card — frosted glass appearance from index.css .glass-card */}
      <div className="glass-card p-8 max-w-sm w-full text-center space-y-6">
        {/* Ghost logo icon centered at top of card */}
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl ghost-gradient mx-auto">
          <Ghost className="w-8 h-8 text-white" />
        </div>

        {/* Status heading and contextual message */}
        <div>
          <h2 className="text-xl font-bold mb-1">Waiting for approval</h2>
          <p className="text-white/50 text-sm">
            {/* Show username and room code for confirmation that the correct room was requested */}
            <span className="text-white font-medium">{username}</span>, your request to join room{' '}
            <span className="font-mono text-ghost-400">{roomCode}</span> has been sent.
          </p>
        </div>

        {/* Animated spinner + status text */}
        <div className="flex items-center justify-center gap-2 text-ghost-400">
          <Loader2 className="w-5 h-5 animate-spin" /> {/* Tailwind animate-spin: CSS rotation */}
          <span className="text-sm">Waiting for the room creator to accept...</span>
        </div>

        {/* Reassurance that no manual action is needed — socket event will auto-transition */}
        <p className="text-white/30 text-xs">
          This page will update automatically once your request is approved.
        </p>
      </div>
    </div>
  );
}
