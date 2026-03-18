import { Users, Crown, Circle } from 'lucide-react';
import { useChat } from '../context/ChatContext';

export default function UserList() {
  const { users, userId, isCreator } = useChat();

  const userEntries = Object.entries(users);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-white/50 text-xs font-medium uppercase tracking-wider px-1">
        <Users className="w-3.5 h-3.5" />
        <span>Online ({userEntries.length})</span>
      </div>
      <div className="space-y-1">
        {userEntries.map(([id, data]) => (
          <div
            key={id}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm ${
              id === userId ? 'bg-ghost-600/20 text-ghost-300' : 'text-white/70'
            }`}
          >
            <Circle className="w-2 h-2 fill-green-400 text-green-400 shrink-0" />
            <span className="truncate">{data.username}</span>
            {id === userId && (
              <span className="text-[10px] text-white/30 ml-auto">(you)</span>
            )}
            {isCreator && id === userId && (
              <Crown className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
