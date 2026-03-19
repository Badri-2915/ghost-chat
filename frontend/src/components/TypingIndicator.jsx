// =============================================================================
// TypingIndicator.jsx — Shows animated dots and names of users currently typing.
// Filters out the current user's own typing events. Handles 1, 2, or N typers.
// =============================================================================

import { useChat } from '../context/ChatContext';

export default function TypingIndicator() {
  const { typingUsers, userId } = useChat();

  const typers = Object.entries(typingUsers)
    .filter(([id]) => id !== userId)
    .map(([, name]) => name);

  if (typers.length === 0) return null;

  const text =
    typers.length === 1
      ? `${typers[0]} is typing`
      : typers.length === 2
        ? `${typers[0]} and ${typers[1]} are typing`
        : `${typers[0]} and ${typers.length - 1} others are typing`;

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-white/40">
      <div className="flex gap-0.5">
        <span className="typing-dot w-1.5 h-1.5 bg-ghost-400 rounded-full inline-block" />
        <span className="typing-dot w-1.5 h-1.5 bg-ghost-400 rounded-full inline-block" />
        <span className="typing-dot w-1.5 h-1.5 bg-ghost-400 rounded-full inline-block" />
      </div>
      <span>{text}</span>
    </div>
  );
}
