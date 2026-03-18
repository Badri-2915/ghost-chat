import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import useSocket from '../hooks/useSocket';
import { deriveRoomKey, encryptMessage, decryptMessage } from '../crypto/encryption';

const ChatContext = createContext(null);

export function ChatProvider({ children }) {
  const { socket, connected, reconnecting, emit, on, off } = useSocket();

  // State
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

  const roomKeyRef = useRef(null);

  // Derive room encryption key when room code is set
  useEffect(() => {
    if (roomCode) {
      deriveRoomKey(roomCode).then((key) => {
        roomKeyRef.current = key;
      });
    }
  }, [roomCode]);

  // Socket event listeners
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
        setScreen('chat');
      },

      'join-rejected': () => {
        setScreen('landing');
        setError('Your join request was rejected.');
      },

      'users-updated': (data) => {
        setUsers(data);
      },

      'join-requests-updated': (data) => {
        setJoinRequests(data);
      },

      'new-message': async (data) => {
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
  }, [socket, on, off, emit, roomCode, userId]);

  // Actions
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
      emit('send-message', { roomCode, encryptedContent, ttl: selectedTTL });
    },
    [emit, roomCode, selectedTTL]
  );

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
    markRead,
    startTyping,
    stopTyping,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
