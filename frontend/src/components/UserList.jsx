// =============================================================================
// UserList.jsx — Sidebar component showing all online users in the room.
// Highlights the current user with "(you)" and shows a crown for the creator.
// Green dot indicates online presence.
// =============================================================================

import { Users, Crown, Circle } from 'lucide-react';
import { useChat } from '../context/ChatContext';

export default function UserList() {
  const { users, userId, creatorId, userStates } = useChat();

  const userEntries = Object.entries(users);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-white/50 text-xs font-medium uppercase tracking-wider px-1">
        <Users className="w-3.5 h-3.5" />
        <span>Online ({userEntries.length})</span>
      </div>
      <div className="space-y-1">
        {userEntries.map(([id, data]) => {
          const name = typeof data === 'string' ? data : data.username || 'Unknown';
          const isInactive = userStates[id] === 'inactive';
          return (
            <div
              key={id}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${
                id === userId ? 'bg-ghost-600/15 text-ghost-300' : 'text-white/70'
              }`}
            >
              <Circle className={`w-2 h-2 shrink-0 ${
                isInactive
                  ? 'fill-white/20 text-white/20'
                  : 'fill-green-400 text-green-400'
              }`} />
              <span className={`truncate ${isInactive ? 'opacity-50' : ''}`}>{name}</span>
              {isInactive && (
                <span className="text-[10px] text-white/20 italic">inactive</span>
              )}
              {id === creatorId && (
                <Crown className="w-3 h-3 text-yellow-400 shrink-0" />
              )}
              {id === userId && (
                <span className="text-[10px] text-white/30 ml-auto">(you)</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
