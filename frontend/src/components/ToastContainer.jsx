// =============================================================================
// ToastContainer.jsx — Renders floating toast notifications.
// Toasts are managed by ChatContext and auto-dismiss after a set duration.
// Types: 'info' (blue), 'warning' (yellow), 'danger' (red), 'join-request' (green).
// Join-request toasts include inline Accept/Reject buttons.
// =============================================================================

// X: dismiss button icon for closing individual toasts
// UserPlus: icon for join-request type toasts
// AlertTriangle: icon for warning type toasts (e.g. panic delete)
// Info: icon for info type toasts (default)
// Camera: icon for danger type toasts (screenshot detection)
import { X, UserPlus, AlertTriangle, Info, Camera } from 'lucide-react';

// useChat: provides toasts queue, dismiss action, join request data, approve/reject actions
import { useChat } from '../context/ChatContext';

// TYPE_STYLES maps toast type to Tailwind background + border color classes.
// All types use semi-transparent backgrounds with backdrop-blur for glass-morphism effect.
const TYPE_STYLES = {
  info:           'bg-ghost-600/90 border-ghost-500/30',    // Default: ghost purple
  warning:        'bg-yellow-600/90 border-yellow-500/30',  // Panic delete / warnings
  danger:         'bg-red-600/90 border-red-500/30',        // Danger alerts
  'join-request': 'bg-emerald-600/90 border-emerald-500/30', // Join requests: green
};

// TYPE_ICONS maps toast type to the Lucide icon component to display.
// 'danger' uses Camera to indicate screenshot awareness.
const TYPE_ICONS = {
  info:           Info,          // Generic informational notification
  warning:        AlertTriangle, // Caution / action warning
  danger:         Camera,        // Screenshot deterrence notification
  'join-request': UserPlus,      // Someone wants to join the room
};

// ToastContainer renders all active toast notifications in a fixed overlay stack.
// Toasts are managed in ChatContext (addToast / dismissToast).
// Join-request toasts include inline Accept/Reject quick-action buttons for the creator.
export default function ToastContainer() {
  // toasts: array of { id, message, type } — maintained by ChatContext addToast/dismissToast
  // dismissToast(id): removes a specific toast immediately
  // joinRequests: { [userId]: { username } } — used to match toast to a pending request
  // approveJoin / rejectJoin: actions to approve or reject the matched join request
  // isCreator: only creators see inline approve/reject buttons on join-request toasts
  const { toasts, dismissToast, joinRequests, approveJoin, rejectJoin, isCreator } = useChat();

  // Render nothing if there are no active toasts (avoids empty fixed overlay)
  if (toasts.length === 0) return null;

  return (
    // Fixed centered overlay at top of screen, pointer-events-none on container
    // so the invisible container div doesn't block clicks on the chat underneath
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 w-full max-w-sm px-4 pointer-events-none">
      {toasts.map((toast) => {
        // Look up the icon component for this toast type (fallback to Info)
        const Icon = TYPE_ICONS[toast.type] || Info;

        // Look up the color style for this toast type (fallback to info style)
        const style = TYPE_STYLES[toast.type] || TYPE_STYLES.info;

        // Only show inline accept/reject buttons for join-request toasts AND only if creator
        const isJoinReq = toast.type === 'join-request' && isCreator;

        // Find the matching pending join request by username prefix match.
        // The toast message format is: "{username} wants to join the room"
        // We match the start of the message against known pending usernames.
        const matchingReqEntry = isJoinReq
          ? Object.entries(joinRequests).find(
              ([, data]) => toast.message.startsWith(data.username)
            )
          : null;

        return (
          // Individual toast card: pointer-events-auto re-enables clicks on the card itself
          <div
            key={toast.id} // Unique float ID ensures React reconciliation is correct
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border backdrop-blur-xl shadow-2xl text-white text-sm animate-slide-in ${style}`}
          >
            {/* Type-specific icon */}
            <Icon className="w-5 h-5 shrink-0 mt-0.5" />

            <div className="flex-1 min-w-0">
              {/* Toast message text */}
              <p className="leading-snug">{toast.message}</p>

              {/* Inline Accept/Reject buttons — only shown for join-request toasts with a matched request */}
              {matchingReqEntry && (
                <div className="flex gap-2 mt-2">
                  {/* Accept button: approves the request and closes the toast */}
                  <button
                    onClick={() => {
                      approveJoin(matchingReqEntry[0]); // matchingReqEntry[0] is the userId
                      dismissToast(toast.id);           // Remove the toast immediately
                    }}
                    className="px-3 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-xs font-medium transition-colors"
                  >
                    Accept
                  </button>
                  {/* Reject button: rejects the request and closes the toast */}
                  <button
                    onClick={() => {
                      rejectJoin(matchingReqEntry[0]); // matchingReqEntry[0] is the userId
                      dismissToast(toast.id);          // Remove the toast immediately
                    }}
                    className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium transition-colors"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>

            {/* Manual dismiss X button — removes toast before auto-dismiss timer fires */}
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
