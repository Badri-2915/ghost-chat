// =============================================================================
// UserList.jsx — Sidebar component showing all online users in the room.
// Highlights the current user with "(you)" and shows a crown for the creator.
// Green dot indicates online presence.
// =============================================================================

// Users: icon for the section header label
// Crown: gold crown icon shown next to the room creator
// Circle: filled/unfilled circle used as presence indicator dot
import { Users, Crown, Circle } from 'lucide-react';

// useChat: provides users map, current userId, creatorId, and 3-state userStates map
import { useChat } from '../context/ChatContext';

// UserList renders all members currently associated with the room in the sidebar.
// Presence state is shown via colored dots:
//   green  = active (tab visible, connected)
//   dim    = inactive (tab hidden, still connected)
//   grey   = offline (socket disconnected, within 5-min grace period)
// Offline users are kept in the list (not removed) until the grace period expires.
export default function UserList() {
  // users: { [userId]: { username, joinedAt } | string } — all room members from server
  // userId: current user's ID — used to highlight "(you)" row and apply self-styling
  // creatorId: the creator's userId — used to show the crown icon
  // userStates: { [userId]: 'active'|'inactive'|'offline' } — 3-state presence map
  const { users, userId, creatorId, userStates } = useChat();

  // Convert users object to an array of [userId, data] pairs for rendering
  const userEntries = Object.entries(users);

  return (
    <div className="space-y-2">
      {/* Section header: icon + label + member count */}
      <div className="flex items-center gap-2 text-white/50 text-xs font-medium uppercase tracking-wider px-1">
        <Users className="w-3.5 h-3.5" />
        <span>In Room ({userEntries.length})</span> {/* Dynamic count of current members */}
      </div>

      {/* Member list */}
      <div className="space-y-1">
        {userEntries.map(([id, data]) => {
          // Support both legacy string format (username only) and new object format ({ username, joinedAt })
          const name = typeof data === 'string' ? data : data.username || 'Unknown';

          // Get presence state — default to 'active' if not tracked yet (e.g. just joined)
          const userState = userStates[id] || 'active';
          const isInactive = userState === 'inactive'; // Tab is hidden, still connected
          const isOffline  = userState === 'offline';  // Socket disconnected (within grace period)

          return (
            // Row: highlighted with subtle ghost tint for the current user
            <div
              key={id} // userId as React key — stable unique identifier
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${
                id === userId ? 'bg-ghost-600/15 text-ghost-300' : 'text-white/70' // Self highlight
              }`}
            >
              {/* Presence dot — color reflects 3-state: green (active) / dim (inactive) / grey (offline) */}
              <Circle className={`w-2 h-2 shrink-0 ${
                isOffline
                  ? 'fill-white/10 text-white/10'   // Grey: disconnected
                  : isInactive
                  ? 'fill-white/20 text-white/20'   // Dim white: tab hidden
                  : 'fill-green-400 text-green-400' // Green: fully active
              }`} />

              {/* Username — dimmed if offline or inactive */}
              <span className={`truncate ${isOffline || isInactive ? 'opacity-50' : ''}`}>{name}</span>

              {/* 'offline' badge — shown only when socket is disconnected */}
              {isOffline && (
                <span className="text-[10px] text-white/20 italic">offline</span>
              )}

              {/* 'inactive' badge — shown when tab is hidden (but not offline) */}
              {isInactive && !isOffline && (
                <span className="text-[10px] text-white/20 italic">inactive</span>
              )}

              {/* Crown icon — shown next to the room creator's row */}
              {id === creatorId && (
                <Crown className="w-3 h-3 text-yellow-400 shrink-0" />
              )}

              {/* "(you)" label — identifies the current user's own row */}
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
