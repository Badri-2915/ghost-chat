// =============================================================================
// TimerSelector.jsx — Horizontal row of TTL (time-to-live) option buttons.
// Lets users pick how long their messages survive before auto-deletion.
// Options: After seen, 5s, 15s, 30s, 1m, 5m.
// =============================================================================

import { Timer } from 'lucide-react';
import { useChat } from '../context/ChatContext';

const TTL_OPTIONS = [
  { value: 'after-seen', label: 'After seen' },
  { value: '5s', label: '5s' },
  { value: '15s', label: '15s' },
  { value: '30s', label: '30s' },
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
];

export default function TimerSelector() {
  const { selectedTTL, setSelectedTTL } = useChat();

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto py-1 px-1">
      <Timer className="w-4 h-4 text-white/40 shrink-0" />
      {TTL_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setSelectedTTL(opt.value)}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
            selectedTTL === opt.value
              ? 'ghost-gradient text-white shadow-sm'
              : 'text-white/40 hover:text-white/70 hover:bg-white/5'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
