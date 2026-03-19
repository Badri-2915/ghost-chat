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

  // ---- New feature state ----
  const [replyTo, setReplyTo] = useState(null);          // message being replied to
  const [toasts, setToasts] = useState([]);               // toast notification queue
  const [userVisibility, setUserVisibility] = useState({}); // userId -> isVisible
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

      'join-approved': () => {
        setScreen('chat');
      },

      'join-rejected': () => {
        setScreen('landing');
        setError('Your join request was rejected.');
      },

      'users-updated': (data) => {
        setUsers(data);
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

        setMessages((prev) => [...prev, msg]);

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

      // Visibility awareness: another user switched tabs
      'user-visibility-changed': ({ userId: uid, username: uname, isVisible }) => {
        setUserVisibility((prev) => ({ ...prev, [uid]: isVisible }));
        if (!isVisible) {
          addToast(`${uname} may be inactive`, 'warning', 3000);
        }
      },

      // Screenshot awareness (best-effort)
      'screenshot-warning': ({ username: uname, timestamp }) => {
        setScreenshotAlerts((prev) => [...prev, { username: uname, timestamp }]);
        addToast(`${uname} may have taken a screenshot`, 'danger', 5000);
        // Auto-clear after 10s
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

  // ---- Tab visibility detection ----
  // Listens to document.visibilitychange and notifies the room when user
  // switches away or returns. Also triggers screenshot warning on blur.
  useEffect(() => {
    if (!roomCode || screen !== 'chat') return;

    let lastHidden = 0;

    const handleVisibility = () => {
      const isVisible = !document.hidden;
      emit('visibility-change', { roomCode, isVisible });

      if (document.hidden) {
        lastHidden = Date.now();
      } else {
        // If user was away for < 2 seconds, might be a screenshot shortcut
        const awayMs = Date.now() - lastHidden;
        if (lastHidden > 0 && awayMs < 2000) {
          emit('screenshot-warning', { roomCode });
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
    markRead,
    startTyping,
    stopTyping,
    // New features
    replyTo,
    setReplyTo,
    toasts,
    dismissToast,
    userVisibility,
    screenshotAlerts,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
