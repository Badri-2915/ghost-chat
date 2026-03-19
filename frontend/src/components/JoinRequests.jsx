// =============================================================================
// JoinRequests.jsx — Sidebar component visible only to the room creator.
// Lists pending join requests with Accept/Reject buttons.
// Also works alongside ToastContainer which shows inline toast notifications
// for new join requests with quick-action buttons.
// =============================================================================

import { UserPlus, Check, X } from 'lucide-react';
import { useChat } from '../context/ChatContext';

export default function JoinRequests() {
  const { joinRequests, approveJoin, rejectJoin, isCreator } = useChat();

  const requests = Object.entries(joinRequests);

  if (!isCreator || requests.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-yellow-400/70 text-xs font-medium uppercase tracking-wider px-1">
        <UserPlus className="w-3.5 h-3.5" />
        <span>Join Requests ({requests.length})</span>
      </div>
      <div className="space-y-1.5">
        {requests.map(([id, data]) => (
          <div
            key={id}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-yellow-500/5 border border-yellow-500/10"
          >
            <span className="text-sm text-white/80 truncate flex-1">{data.username}</span>
            <button
              onClick={() => approveJoin(id)}
              className="w-7 h-7 rounded-lg bg-green-500/20 flex items-center justify-center hover:bg-green-500/30 transition-colors"
              title="Accept"
            >
              <Check className="w-4 h-4 text-green-400" />
            </button>
            <button
              onClick={() => rejectJoin(id)}
              className="w-7 h-7 rounded-lg bg-red-500/20 flex items-center justify-center hover:bg-red-500/30 transition-colors"
              title="Reject"
            >
              <X className="w-4 h-4 text-red-400" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
