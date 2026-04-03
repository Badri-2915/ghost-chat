// =============================================================================
// TimerSelector.jsx — Horizontal row of TTL (time-to-live) option buttons.
// Lets users pick how long their messages survive before auto-deletion.
// Options: After seen, 5s, 15s, 30s, 1m, 5m.
// =============================================================================

// Timer: clock icon shown at the left of the TTL option row
import { Timer } from 'lucide-react';

// useChat: provides selectedTTL (current choice) and setSelectedTTL (setter) from global context
import { useChat } from '../context/ChatContext';

// TTL_OPTIONS defines all available message lifetime choices.
// 'value' is the string stored in context and sent with each message payload.
// 'label' is the human-readable button text shown in the UI.
// 'after-seen' is a special case: the countdown starts once the recipient reads the message.
const TTL_OPTIONS = [
  { value: 'after-seen', label: 'After seen' }, // Self-destructs 3s after recipient reads it
  { value: '5s',  label: '5s'  },               // Deletes 5 seconds after being received
  { value: '15s', label: '15s' },               // Deletes 15 seconds after being received
  { value: '30s', label: '30s' },               // Deletes 30 seconds after being received
  { value: '1m',  label: '1m'  },               // Deletes 1 minute after being received
  { value: '5m',  label: '5m'  },               // Deletes 5 minutes after being received (default)
];

// TimerSelector renders a horizontal scrollable row of TTL option buttons.
// Props:
//   onSelect: optional callback fired after a selection (used by ChatRoom to close the picker popover)
export default function TimerSelector({ onSelect }) {
  // selectedTTL: the currently active TTL value (highlighted with ghost-gradient)
  // setSelectedTTL: updates the context so new messages use the new TTL
  const { selectedTTL, setSelectedTTL } = useChat();

  return (
    // Horizontal scrolling row — allows all options to fit on narrow screens
    <div className="flex items-center gap-1.5 overflow-x-auto py-1 px-1">
      {/* Timer icon as visual label for the row */}
      <Timer className="w-3.5 h-3.5 text-white/40 shrink-0" />

      {/* Render one button per TTL option */}
      {TTL_OPTIONS.map((opt) => (
        <button
          key={opt.value}  // React key — stable since TTL values are constant
          onClick={() => {
            setSelectedTTL(opt.value); // Update context — affects all future messages
            if (onSelect) onSelect(opt.value); // Notify parent to close popover (optional)
          }}
          // Active option: ghost purple gradient background with white text
          // Inactive option: muted text, subtle hover state
          className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
            selectedTTL === opt.value
              ? 'ghost-gradient text-white shadow-sm'       // Selected state
              : 'text-white/40 hover:text-white/70 hover:bg-white/5' // Unselected state
          }`}
        >
          {opt.label} {/* Display text: 'After seen', '5s', '1m', etc. */}
        </button>
      ))}
    </div>
  );
}
