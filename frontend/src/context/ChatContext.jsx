// =============================================================================
// ChatContext.jsx — Central state management for Ghost Chat.
// Manages all chat state: user identity, room info, messages, join requests,
// typing indicators, toasts, reply state, visibility awareness, and provides
// action functions (create/join room, send message, panic delete, etc.).
// All Socket.IO event listeners are registered here.
// =============================================================================

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import useSocket from '../hooks/useSocket';
import { deriveRoomKey, encryptMessage, decryptMessage } from '../crypto/encryption';

const ChatContext = createContext(null);

export function ChatProvider({ children }) {
  const { socket, connected, reconnecting, emit, on, off } = useSocket();

  // ---- Core state ----
  const [screen, setScreen] = useState('landing'); // landing | waiting | chat
  const [username, setUsername] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [userId, setUserId] = useState('');
  const [isCreator, setIsCreator] = useState(false);
  const [users, setUsers] = useState({});
  const [messages, setMessages] = useState([]);
  const [joinRequests, setJoinRequests] = useState({});
  const [typingUsers, setTypingUsers] = useState({});
  const [error, setError] = useState('');
  const [selectedTTL, setSelectedTTL] = useState('5m');
  const [creatorId, setCreatorId] = useState('');

  // ---- New feature state ----
  const [replyTo, setReplyTo] = useState(null);          // message being replied to
  const [toasts, setToasts] = useState([]);               // toast notification queue
  const [userVisibility, setUserVisibility] = useState({}); // userId -> isVisible
  const [userStates, setUserStates] = useState({});           // userId -> 'active'|'inactive'
  const [screenshotAlerts, setScreenshotAlerts] = useState([]); // screenshot warnings

  const roomKeyRef = useRef(null);

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

  // Derive room encryption key when room code is set
  useEffect(() => {
    if (roomCode) {
      deriveRoomKey(roomCode).then((key) => {
        roomKeyRef.current = key;
      });
    }
  }, [roomCode]);

  // ---- Socket event listeners ----
  useEffect(() => {
    if (!socket) return;

    const handlers = {
      'room-created': async (data) => {
        setRoomCode(data.roomCode);
        setUserId(data.userId);
        setUsername(data.username);
        setIsCreator(true);
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
        setScreen('chat');
      },

      'join-rejected': () => {
        setScreen('landing');
        setError('Your join request was rejected.');
      },

      'users-updated': (data) => {
        // data is { users: { userId: { username, joinedAt } }, creator: string }
        if (data && data.users) {
          setUsers(data.users);
          if (data.creator) setCreatorId(data.creator);
        } else {
          // Backward compat: plain object
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

        // Send delivered receipt (if not own message)
        if (data.senderId !== userId) {
          emit('message-delivered', { roomCode, messageId: data.messageId });
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

      'user-left': ({ userId: leftId, username: leftName }) => {
        setTypingUsers((prev) => {
          const next = { ...prev };
          delete next[leftId];
          return next;
        });
        addToast(`${leftName} left the room`, 'info', 3000);
      },

      'user-rejoined': ({ userId: rejoinId, username: rejoinName }) => {
        if (rejoinId !== userId) {
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
        if (state === 'inactive' && uid !== userId) {
          addToast(`${uname} is inactive (tab switched)`, 'info', 3000);
        }
      },

      // Screenshot awareness (best-effort, minimal)
      'screenshot-warning': ({ username: uname, timestamp }) => {
        setScreenshotAlerts((prev) => [...prev, { username: uname, timestamp }]);
        addToast(`${uname} may have taken a screenshot`, 'danger', 5000);
        setTimeout(() => {
          setScreenshotAlerts((prev) => prev.filter((a) => a.timestamp !== timestamp));
        }, 10000);
      },

      'error-message': ({ message }) => {
        setError(message);
        setTimeout(() => setError(''), 5000);
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

  // ---- Reconnect recovery ----
  // When socket reconnects and user was in a chat, re-register with the room
  useEffect(() => {
    if (!socket) return;

    const handleReconnect = () => {
      if (screen === 'chat' && roomCode && userId && username) {
        emit('rejoin-room', { roomCode, userId, username });
        console.log('[Reconnect] Rejoining room:', roomCode);
      }
    };

    socket.io.on('reconnect', handleReconnect);
    return () => {
      socket.io.off('reconnect', handleReconnect);
    };
  }, [socket, screen, roomCode, userId, username, emit]);

  // ---- Tab visibility & 3-state presence ----
  // Emits user_inactive / user_active for presence state.
  // Also triggers screenshot warning if tab hidden < 3s (heuristic).
  useEffect(() => {
    if (!roomCode || screen !== 'chat') return;

    let lastHidden = 0;

    const handleVisibility = () => {
      if (document.hidden) {
        lastHidden = Date.now();
        emit('user_inactive');
      } else {
        emit('user_active');
        // Screenshot heuristic: hidden < 3s might be screenshot shortcut
        if (lastHidden > 0) {
          const awayMs = Date.now() - lastHidden;
          if (awayMs < 3000) {
            emit('screenshot-warning', { roomCode });
          }
          lastHidden = 0;
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [roomCode, screen, emit]);

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
      emit('join-request', { roomCode: code, username: name });
    },
    [emit]
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

  const deleteMessage = useCallback(
    (messageId) => {
      emit('delete-message', { roomCode, messageId });
    },
    [emit, roomCode]
  );

  // Panic delete: wipe all messages for all users in the room
  const panicDelete = useCallback(() => {
    emit('panic-delete', { roomCode });
  }, [emit, roomCode]);

  // Leave room: disconnect from current room and reset to landing
  const leaveRoom = useCallback(() => {
    setScreen('landing');
    setRoomCode('');
    setUserId('');
    setUsername('');
    setIsCreator(false);
    setCreatorId('');
    setUsers({});
    setMessages([]);
    setJoinRequests({});
    setTypingUsers({});
    setReplyTo(null);
    setToasts([]);
    setError('');
    roomKeyRef.current = null;
    // Socket disconnect triggers server-side cleanup; reconnect for fresh state
    if (socket) {
      socket.disconnect();
      socket.connect();
    }
  }, [socket]);

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
    screenshotAlerts,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
