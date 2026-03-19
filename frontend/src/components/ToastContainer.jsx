// =============================================================================
// ToastContainer.jsx — Renders floating toast notifications.
// Toasts are managed by ChatContext and auto-dismiss after a set duration.
// Types: 'info' (blue), 'warning' (yellow), 'danger' (red), 'join-request' (green).
// Join-request toasts include inline Accept/Reject buttons.
// =============================================================================

import { X, UserPlus, AlertTriangle, Info, Camera } from 'lucide-react';
import { useChat } from '../context/ChatContext';

const TYPE_STYLES = {
  info: 'bg-ghost-600/90 border-ghost-500/30',
  warning: 'bg-yellow-600/90 border-yellow-500/30',
  danger: 'bg-red-600/90 border-red-500/30',
  'join-request': 'bg-emerald-600/90 border-emerald-500/30',
};

const TYPE_ICONS = {
  info: Info,
  warning: AlertTriangle,
  danger: Camera,
  'join-request': UserPlus,
};

export default function ToastContainer() {
  const { toasts, dismissToast, joinRequests, approveJoin, rejectJoin, isCreator } = useChat();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 w-full max-w-sm px-4 pointer-events-none">
      {toasts.map((toast) => {
        const Icon = TYPE_ICONS[toast.type] || Info;
        const style = TYPE_STYLES[toast.type] || TYPE_STYLES.info;
        const isJoinReq = toast.type === 'join-request' && isCreator;

        // Find matching join request for inline buttons
        const matchingReqEntry = isJoinReq
          ? Object.entries(joinRequests).find(
              ([, data]) => toast.message.startsWith(data.username)
            )
          : null;

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border backdrop-blur-xl shadow-2xl text-white text-sm animate-slide-in ${style}`}
          >
            <Icon className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="leading-snug">{toast.message}</p>
              {/* Inline Accept/Reject for join requests */}
              {matchingReqEntry && (
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => {
                      approveJoin(matchingReqEntry[0]);
                      dismissToast(toast.id);
                    }}
                    className="px-3 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-xs font-medium transition-colors"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => {
                      rejectJoin(matchingReqEntry[0]);
                      dismissToast(toast.id);
                    }}
                    className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium transition-colors"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={() => dismissToast(toast.id)}
              className="shrink-0 text-white/60 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
