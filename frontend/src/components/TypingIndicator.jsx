// =============================================================================
// TypingIndicator.jsx — Shows animated dots and names of users currently typing.
// Filters out the current user's own typing events. Handles 1, 2, or N typers.
// =============================================================================

// useChat provides typingUsers (map of userId → username) and userId (current user's ID)
import { useChat } from '../context/ChatContext';

// TypingIndicator shows a three-dot animation and the names of users currently typing.
// It reads from the typingUsers map in ChatContext, which is updated by 'user-typing'
// and 'user-stopped-typing' socket events. It never shows the current user's own typing.
export default function TypingIndicator() {
  // typingUsers: { [userId]: username } — populated by server 'user-typing' events
  // userId: current user's ID — used to filter out own typing from the display
  const { typingUsers, userId } = useChat();

  // Build array of display names of users currently typing (excluding ourselves)
  // Object.entries gives [id, name] pairs; we filter by id !== userId, then extract names
  const typers = Object.entries(typingUsers)
    .filter(([id]) => id !== userId) // Exclude current user's own typing events
    .map(([, name]) => name);         // Extract just the display names

  // If nobody else is typing, render nothing (component returns null = no DOM node)
  if (typers.length === 0) return null;

  // Build the human-readable typing label based on how many people are typing:
  // 1 person: "Alice is typing"
  // 2 people: "Alice and Bob are typing"
  // 3+ people: "Alice and 2 others are typing" (avoids very long strings)
  const text =
    typers.length === 1
      ? `${typers[0]} is typing`
      : typers.length === 2
        ? `${typers[0]} and ${typers[1]} are typing`
        : `${typers[0]} and ${typers.length - 1} others are typing`;

  return (
    // Container row: dots + text, subtle opacity so it doesn't distract from messages
    <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-white/40">
      {/* Three animated dots — CSS animation 'typing-dot' defined in index.css */}
      {/* Each dot staggers its animation via CSS nth-child delay (bounce effect) */}
      <div className="flex gap-0.5">
        <span className="typing-dot w-1.5 h-1.5 bg-ghost-400 rounded-full inline-block" />
        <span className="typing-dot w-1.5 h-1.5 bg-ghost-400 rounded-full inline-block" />
        <span className="typing-dot w-1.5 h-1.5 bg-ghost-400 rounded-full inline-block" />
      </div>
      {/* The formatted "X is typing" text */}
      <span>{text}</span>
    </div>
  );
}
