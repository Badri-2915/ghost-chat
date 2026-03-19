// =============================================================================
// useSocket.js — Custom React hook for Socket.IO connection management.
// Creates a single persistent WebSocket connection to the backend server.
// Handles auto-reconnect with exponential backoff, and exposes emit/on/off
// functions that are stable across re-renders (via useCallback).
//
// SOCKET_URL: In dev, Vite proxy handles routing; in prod, same origin is used.
// =============================================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

// Empty string means "same origin" — works in production where frontend is
// served by the same Express server. In dev, Vite proxy forwards /socket.io.
const SOCKET_URL = import.meta.env.VITE_API_URL || '';

export default function useSocket() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setReconnecting(false);
      console.log('[Socket] Connected:', socket.id);
    });

    socket.on('disconnect', (reason) => {
      setConnected(false);
      console.log('[Socket] Disconnected:', reason);
      // If server closed the connection, attempt reconnect
      if (reason === 'io server disconnect') {
        socket.connect();
      }
    });

    socket.io.on('reconnect_attempt', () => {
      setReconnecting(true);
    });

    socket.io.on('reconnect', () => {
      setReconnecting(false);
      setConnected(true);
    });

    // Handle browser online/offline events
    const handleOnline = () => {
      if (!socket.connected) {
        setReconnecting(true);
        socket.connect();
      }
    };
    const handleOffline = () => {
      setConnected(false);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      socket.disconnect();
    };
  }, []);

  const emit = useCallback((event, data) => {
    if (socketRef.current) {
      socketRef.current.emit(event, data);
    }
  }, []);

  const on = useCallback((event, callback) => {
    if (socketRef.current) {
      socketRef.current.on(event, callback);
    }
  }, []);

  const off = useCallback((event, callback) => {
    if (socketRef.current) {
      socketRef.current.off(event, callback);
    }
  }, []);

  return { socket: socketRef.current, connected, reconnecting, emit, on, off };
}
