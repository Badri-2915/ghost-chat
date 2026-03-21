// =============================================================================
// ChatContext.jsx — Central state management for Ghost Chat.
// Manages all chat state: user identity, room info, messages, join requests,
// typing indicators, toasts, reply state, visibility awareness, and provides
// action functions (create/join room, send message, panic delete, etc.).
//
// Presence states: active | inactive (tab switched) | offline (disconnected)
// Delete permission: only sender can delete own messages (server enforces).
// Identity: creatorToken (secret) is used for creator rejoin, NOT username.
// All Socket.IO event listeners are registered here.
// =============================================================================

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import useSocket from '../hooks/useSocket';
import { deriveRoomKey, encryptMessage, decryptMessage } from '../crypto/encryption';

const ChatContext = createContext(null);

// ---- Session persistence helpers ----
const SESSION_KEY = 'gc_session';
const TOKEN_PREFIX = 'gc_ct_'; // localStorage key prefix for creatorToken per room

function saveSession(data) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch (e) { /* private mode */ }
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ok */ }
}

// Store creatorToken per room in localStorage — survives page close, leave, and rejoin
function saveCreatorToken(roomCode, token) {
  if (!roomCode || !token) return;
  try { localStorage.setItem(TOKEN_PREFIX + roomCode, token); } catch (e) { /* ok */ }
}

function loadCreatorToken(roomCode) {
  if (!roomCode) return '';
  try { return localStorage.getItem(TOKEN_PREFIX + roomCode) || ''; } catch (e) { return ''; }
}

function clearCreatorToken(roomCode) {
  if (!roomCode) return;
  try { localStorage.removeItem(TOKEN_PREFIX + roomCode); } catch (e) { /* ok */ }
}

export function ChatProvider({ children }) {
  const { socket, connected, reconnecting, emit, on, off } = useSocket();

  // ---- Restore saved session on mount (lazy — runs only once) ----
  const savedRef = useRef(loadSession());

  // ---- Core state ----
  const [screen, setScreen] = useState(() => savedRef.current?.screen === 'chat' ? 'chat' : 'landing');
  const [username, setUsername] = useState(() => savedRef.current?.username || '');
  const [roomCode, setRoomCode] = useState(() => savedRef.current?.roomCode || '');
  const [userId, setUserId] = useState(() => savedRef.current?.userId || '');
  const [isCreator, setIsCreator] = useState(() => savedRef.current?.isCreator || false);
  const [users, setUsers] = useState({});
  const [messages, setMessages] = useState([]);
  const [joinRequests, setJoinRequests] = useState({});
  const [typingUsers, setTypingUsers] = useState({});
  const [error, setError] = useState('');
  const [selectedTTL, setSelectedTTL] = useState('5m');
  const [creatorId, setCreatorId] = useState(() => savedRef.current?.creatorId || '');
  const [creatorToken, setCreatorToken] = useState(() => savedRef.current?.creatorToken || ''); // Secret token for creator rejoin
  const hasAutoRejoined = useRef(false); // Prevent double auto-rejoin

  // ---- New feature state ----
  const [replyTo, setReplyTo] = useState(null);          // message being replied to
  const [toasts, setToasts] = useState([]);               // toast notification queue
  const [userVisibility, setUserVisibility] = useState({}); // userId -> isVisible
  const [userStates, setUserStates] = useState({});           // userId -> 'active'|'inactive'
  const offlineUserIds = useRef(new Set());                    // Track offline users to prevent re-adding

  const roomKeyRef = useRef(null);
  const userIdRef = useRef(userId);
  const roomCodeRef = useRef(roomCode);

  // Keep refs in sync with state
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { roomCodeRef.current = roomCode; }, [roomCode]);

  // Helper: add a toast notification (auto-dismisses after duration ms)
  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  // Dismiss a specific toast by id
  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ---- Persist session whenever critical state changes ----
  useEffect(() => {
    if (screen === 'chat' && roomCode && userId) {
      saveSession({ screen, username, roomCode, userId, isCreator, creatorToken, creatorId });
    }
  }, [screen, username, roomCode, userId, isCreator, creatorToken, creatorId]);

  // Derive room encryption key when room code is set
  useEffect(() => {
    if (roomCode) {
      deriveRoomKey(roomCode).then((key) => {
        roomKeyRef.current = key;
      });
    }
  }, [roomCode]);

  // ---- Auto-rejoin on connect/reconnect if we have a session ----
  // This single effect handles BOTH initial page load AND socket reconnect.
  // hasAutoRejoined resets on disconnect so it fires again on reconnect.
  useEffect(() => {
    if (!socket) return;

    // Reset the flag on disconnect so we rejoin on next connect
    const handleDisconnect = () => {
      hasAutoRejoined.current = false;
    };
    socket.on('disconnect', handleDisconnect);

    if (connected && !hasAutoRejoined.current && screen === 'chat' && roomCode && userId && username) {
      hasAutoRejoined.current = true;
      offlineUserIds.current.clear();
      const token = creatorToken || loadCreatorToken(roomCode);
      emit('rejoin-room', { roomCode, userId, username, creatorToken: token || undefined });
      console.log('[AutoRejoin] Restoring session:', roomCode, token ? '(creator)' : '(user)');
    }

    return () => {
      socket.off('disconnect', handleDisconnect);
    };
  }, [socket, connected, screen, roomCode, userId, username, creatorToken, emit]);

  // ---- Socket event listeners ----
  useEffect(() => {
    if (!socket) return;

    const handlers = {
      'room-created': async (data) => {
        setRoomCode(data.roomCode);
        setUserId(data.userId);
        setUsername(data.username);
        setIsCreator(true);
        if (data.creatorToken) {
          setCreatorToken(data.creatorToken);
          saveCreatorToken(data.roomCode, data.creatorToken);
        }
        setScreen('chat');
      },

      'join-requested': (data) => {
        setRoomCode(data.roomCode);
        setUserId(data.userId);
        setUsername(data.username);
        setScreen('waiting');
      },

      'join-approved': (data) => {
        if (data?.userId) setUserId(data.userId);
        if (data?.username) setUsername(data.username);
        if (data?.roomCode) setRoomCode(data.roomCode);
        if (data?.isCreator) setIsCreator(true);
        if (data?.creatorId) setCreatorId(data.creatorId);
        if (data?.creatorToken) {
          setCreatorToken(data.creatorToken);
          saveCreatorToken(data.roomCode, data.creatorToken);
        }
        setScreen('chat');
      },

      'join-rejected': () => {
        setScreen('landing');
        setError('Your join request was rejected.');
      },

      'users-updated': (data) => {
        // data is { users: { userId: { username, joinedAt } }, creator: string }
        if (data && data.users) {
          // Filter out users we know are offline (prevents re-adding after user-left)
          const filtered = { ...data.users };
          for (const uid of offlineUserIds.current) {
            if (filtered[uid]) delete filtered[uid];
          }
          setUsers(filtered);
          if (data.creator) setCreatorId(data.creator);
        } else {
          setUsers(data);
        }
      },

      // Join requests — also trigger a visible toast for the creator
      'join-requests-updated': (data) => {
        setJoinRequests((prev) => {
          // Detect new requests (keys in data not in prev)
          const prevIds = Object.keys(prev);
          const newIds = Object.keys(data);
          const added = newIds.filter((id) => !prevIds.includes(id));
          added.forEach((id) => {
            if (data[id]?.username) {
              addToast(`${data[id].username} wants to join the room`, 'join-request', 8000);
            }
          });
          return data;
        });
      },

      'new-message': async (data) => {
        // Decrypt message content if encryption key is available
        let decryptedContent = data.encryptedContent;
        try {
          if (roomKeyRef.current && data.encryptedContent?.iv) {
            decryptedContent = await decryptMessage(roomKeyRef.current, data.encryptedContent);
          }
        } catch (e) {
          decryptedContent = '[Decryption failed]';
        }

        const msg = {
          ...data,
          content: decryptedContent,
          receivedAt: Date.now(),
        };

        setMessages((prev) => {
          if (prev.some((m) => m.messageId === msg.messageId)) return prev;
          return [...prev, msg];
        });

        // Send delivered receipt (if not own message) — use refs for current values
        if (data.senderId !== userIdRef.current) {
          emit('message-delivered', { roomCode: roomCodeRef.current, messageId: data.messageId });
        }
      },

      'message-status-update': ({ messageId, status }) => {
        setMessages((prev) =>
          prev.map((m) => (m.messageId === messageId ? { ...m, status } : m))
        );
      },

      'message-deleted': ({ messageId }) => {
        setMessages((prev) => prev.filter((m) => m.messageId !== messageId));
      },

      // Panic delete: clear all messages from UI
      'panic-delete': ({ triggeredBy }) => {
        setMessages([]);
        addToast(`${triggeredBy} deleted all messages`, 'warning', 3000);
      },

      'user-typing': ({ userId: typerId, username: typerName }) => {
        setTypingUsers((prev) => ({ ...prev, [typerId]: typerName }));
      },

      'user-stopped-typing': ({ userId: typerId }) => {
        setTypingUsers((prev) => {
          const next = { ...prev };
          delete next[typerId];
          return next;
        });
      },

      // Explicit leave — user clicked "Leave Room" button
      'user-left-room': ({ userId: leftId, username: leftName }) => {
        setTypingUsers((prev) => { const n = { ...prev }; delete n[leftId]; return n; });
        setUserStates((prev) => { const n = { ...prev }; delete n[leftId]; return n; });
        offlineUserIds.current.delete(leftId);
        // Remove from users list immediately — they left intentionally
        setUsers((prev) => { const n = { ...prev }; delete n[leftId]; return n; });
        addToast(`${leftName} left the room`, 'info', 3000);
      },

      // Network disconnect — user lost connection (may reconnect)
      'user-left': ({ userId: leftId, username: leftName }) => {
        setTypingUsers((prev) => { const n = { ...prev }; delete n[leftId]; return n; });
        // Mark user as offline — keep in list so they show as "offline"
        setUserStates((prev) => ({ ...prev, [leftId]: 'offline' }));
        offlineUserIds.current.add(leftId);
        addToast(`${leftName} disconnected`, 'info', 3000);
      },

      'user-joined': ({ userId: joinId, username: joinName }) => {
        // First-time join (after approval) — NOT a rejoin
        offlineUserIds.current.delete(joinId);
        setUserStates((prev) => ({ ...prev, [joinId]: 'active' }));
        if (joinId !== userIdRef.current) {
          addToast(`${joinName} joined the room`, 'info', 3000);
        }
      },

      'user-rejoined': ({ userId: rejoinId, username: rejoinName }) => {
        // User is back online — remove from offline tracking
        offlineUserIds.current.delete(rejoinId);
        setUserStates((prev) => ({ ...prev, [rejoinId]: 'active' }));
        if (rejoinId !== userIdRef.current) {
          addToast(`${rejoinName} rejoined the room`, 'info', 3000);
        }
      },

      // Visibility awareness: another user switched tabs (track silently)
      'user-visibility-changed': ({ userId: uid, isVisible }) => {
        setUserVisibility((prev) => ({ ...prev, [uid]: isVisible }));
      },

      // 3-state presence: active / inactive / offline
      'user-state-changed': ({ userId: uid, username: uname, state }) => {
        setUserStates((prev) => ({ ...prev, [uid]: state }));
        if (state === 'inactive' && uid !== userIdRef.current) {
          addToast(`${uname} is inactive (tab switched)`, 'info', 3000);
        }
      },

      'error-message': ({ message }) => {
        setError(message);
        setTimeout(() => setError(''), 5000);
        // If room is gone, clear session and go back to landing
        if (message && (message.includes('no longer exists') || message.includes('not found'))) {
          clearSession();
          hasAutoRejoined.current = false;
          setScreen('landing');
          setRoomCode('');
          setUserId('');
          setCreatorToken('');
          setIsCreator(false);
        }
      },
    };

    for (const [event, handler] of Object.entries(handlers)) {
      on(event, handler);
    }

    return () => {
      for (const [event, handler] of Object.entries(handlers)) {
        off(event, handler);
      }
    };
  }, [socket, on, off, emit, roomCode, userId, addToast]);

  // Reconnect recovery is now handled by the auto-rejoin effect above.
  // hasAutoRejoined resets on disconnect, so when connected becomes true again,
  // the auto-rejoin effect fires and emits rejoin-room exactly ONCE.

  // ---- Tab visibility & 3-state presence ----
  // Emits user_inactive / user_active for presence state tracking.
  useEffect(() => {
    if (!roomCode || screen !== 'chat') return;

    const handleVisibility = () => {
      if (document.hidden) {
        emit('user_inactive');
      } else {
        emit('user_active');
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [roomCode, screen, emit]);

  // ---- Notify server on intentional page close (not refresh) ----
  // Uses sendBeacon for reliable delivery during unload.
  // Only fires when the page is actually being closed, not on SPA navigation.
  useEffect(() => {
    if (!socket || screen !== 'chat' || !roomCode) return;

    const handleBeforeUnload = () => {
      // sendBeacon tells server to force-disconnect this socket immediately
      // so other users see offline status without waiting for pingTimeout.
      const url = (import.meta.env.VITE_API_URL || '') + '/api/leave';
      const payload = JSON.stringify({ roomCode, userId });
      try {
        navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      } catch (e) { /* fallback: socket will disconnect naturally */ }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [socket, screen, roomCode, userId]);

  // ---- Actions ----
  const createRoom = useCallback(
    (name) => {
      setUsername(name);
      emit('create-room', { username: name });
    },
    [emit]
  );

  const joinRoom = useCallback(
    (name, code) => {
      setUsername(name);
      setRoomCode(code);
      // Look up stored creatorToken for this room (survives leave + page close)
      const storedToken = creatorToken || loadCreatorToken(code);
      emit('join-request', { roomCode: code, username: name, creatorToken: storedToken || undefined });
    },
    [emit, creatorToken]
  );

  const approveJoin = useCallback(
    (targetUserId) => {
      emit('approve-join', { roomCode, userId: targetUserId });
    },
    [emit, roomCode]
  );

  const rejectJoin = useCallback(
    (targetUserId) => {
      emit('reject-join', { roomCode, userId: targetUserId });
    },
    [emit, roomCode]
  );

  // Send message with optional reply reference
  const sendMessage = useCallback(
    async (text) => {
      let encryptedContent = text;
      try {
        if (roomKeyRef.current) {
          encryptedContent = await encryptMessage(roomKeyRef.current, text);
        }
      } catch (e) {
        console.error('[Crypto] Encryption failed:', e);
      }

      const payload = { roomCode, encryptedContent, ttl: selectedTTL };

      // Attach reply reference if replying to a message
      if (replyTo) {
        payload.replyTo = {
          messageId: replyTo.messageId,
          senderName: replyTo.senderName,
          content: replyTo.content?.substring(0, 100) || '', // truncated preview
        };
      }

      emit('send-message', payload);
      setReplyTo(null); // clear reply state after sending
    },
    [emit, roomCode, selectedTTL, replyTo]
  );

  // Delete message: pass senderId so server can enforce sender-only permission
  const deleteMessage = useCallback(
    (messageId, senderId) => {
      emit('delete-message', { roomCode, messageId, senderId });
    },
    [emit, roomCode]
  );

  // Panic delete: wipe all messages for all users in the room
  const panicDelete = useCallback(() => {
    emit('panic-delete', { roomCode });
  }, [emit, roomCode]);

  // Leave room: disconnect from current room and reset to landing
  const leaveRoom = useCallback(() => {
    clearSession();
    hasAutoRejoined.current = false;
    offlineUserIds.current.clear();
    setScreen('landing');
    setRoomCode('');
    setUserId('');
    setUsername('');
    setIsCreator(false);
    setCreatorId('');
    setCreatorToken('');
    setUsers({});
    setMessages([]);
    setJoinRequests({});
    setTypingUsers({});
    setReplyTo(null);
    setToasts([]);
    setError('');
    roomKeyRef.current = null;
    // Emit explicit leave so server differentiates from network disconnect
    if (socket) {
      emit('leave-room');
      socket.disconnect();
      socket.connect();
    }
  }, [socket, emit]);

  const markRead = useCallback(
    (messageId) => {
      emit('message-read', { roomCode, messageId });
    },
    [emit, roomCode]
  );

  const startTyping = useCallback(() => {
    emit('typing-start', { roomCode });
  }, [emit, roomCode]);

  const stopTyping = useCallback(() => {
    emit('typing-stop', { roomCode });
  }, [emit, roomCode]);

  const value = {
    connected,
    reconnecting,
    screen,
    username,
    roomCode,
    userId,
    isCreator,
    users,
    messages,
    joinRequests,
    typingUsers,
    error,
    selectedTTL,
    setSelectedTTL,
    setMessages,
    createRoom,
    joinRoom,
    approveJoin,
    rejectJoin,
    sendMessage,
    deleteMessage,
    panicDelete,
    leaveRoom,
    markRead,
    startTyping,
    stopTyping,
    // New features
    replyTo,
    setReplyTo,
    toasts,
    dismissToast,
    creatorId,
    userVisibility,
    userStates,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
