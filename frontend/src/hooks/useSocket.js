// =============================================================================
// useSocket.js — Custom React hook for Socket.IO connection management.
// Creates a single persistent WebSocket connection to the backend server.
// Handles auto-reconnect with exponential backoff, and exposes emit/on/off
// functions that are stable across re-renders (via useCallback).
//
// SOCKET_URL: In dev, Vite proxy handles routing; in prod, same origin is used.
// =============================================================================

// useEffect: runs once on mount to create the socket connection
// useRef: holds the socket instance without triggering re-renders
// useState: drives 'connected' and 'reconnecting' UI state
// useCallback: produces stable function references that don't change across renders
import { useEffect, useRef, useState, useCallback } from 'react';

// io from socket.io-client creates the WebSocket connection to the backend
import { io } from 'socket.io-client';

// VITE_API_URL is set in .env for local development (e.g. http://localhost:3001).
// Empty string = same origin, which works in production where the backend serves the frontend.
// In dev, Vite's proxy (configured in vite.config.js) forwards /socket.io to localhost:3001.
const SOCKET_URL = import.meta.env.VITE_API_URL || '';

export default function useSocket() {
  // socketRef stores the Socket.IO client instance persistently across renders.
  // Using a ref (not state) ensures the socket isn't recreated on every state change.
  const socketRef = useRef(null);

  // connected: true when the WebSocket handshake is complete and the socket is live
  const [connected, setConnected] = useState(false);

  // reconnecting: true while Socket.IO is actively trying to re-establish a lost connection
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    // Create the Socket.IO client connection on component mount.
    // This runs only once (empty dep array) — creates one socket for the app's lifetime.
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'], // Try WebSocket first; fall back to long-polling
      reconnection: true,                   // Automatically attempt reconnection on disconnect
      reconnectionAttempts: Infinity,       // Retry forever — user stays in room until they leave
      reconnectionDelay: 1000,             // Wait 1s before first reconnect attempt
      reconnectionDelayMax: 5000,          // Cap delay at 5s to avoid very long waits
    });

    // Store the socket instance in the ref so it's accessible by emit/on/off callbacks
    socketRef.current = socket;

    // 'connect' fires when the WebSocket handshake completes (initial connect or reconnect)
    socket.on('connect', () => {
      setConnected(true);       // Update UI to show "connected" state
      setReconnecting(false);   // Clear any reconnecting indicator
      console.log('[Socket] Connected:', socket.id);
    });

    // 'disconnect' fires when the connection is lost (server close, network drop, tab close)
    socket.on('disconnect', (reason) => {
      setConnected(false); // Update UI to show "disconnected" state
      console.log('[Socket] Disconnected:', reason);
      // 'io server disconnect' means the server explicitly kicked this socket.
      // In this case, Socket.IO won't auto-reconnect — we must manually call connect().
      if (reason === 'io server disconnect') {
        socket.connect(); // Manually initiate reconnect
      }
      // For other reasons (transport error, network drop), Socket.IO handles reconnect automatically
    });

    // 'reconnect_attempt' fires at the start of each reconnection attempt
    // Used to show a "Reconnecting..." banner in the UI
    socket.io.on('reconnect_attempt', () => {
      setReconnecting(true); // Show reconnecting indicator
    });

    // 'reconnect' fires when a reconnect attempt succeeds
    // Note: 'connect' will also fire, but this is an additional hook for reconnect-specific logic
    socket.io.on('reconnect', () => {
      setReconnecting(false); // Hide reconnecting indicator
      setConnected(true);     // Confirm connected state
    });

    // Browser-level network events — complement Socket.IO's reconnect logic.
    // When the device comes back online, proactively trigger a reconnect.
    const handleOnline = () => {
      if (!socket.connected) {
        setReconnecting(true);  // Show reconnecting indicator immediately
        socket.connect();       // Start Socket.IO connection attempt
      }
    };

    // When the device goes offline, update UI immediately without waiting for pingTimeout
    const handleOffline = () => {
      setConnected(false); // Show disconnected state right away
    };

    window.addEventListener('online', handleOnline);   // Network restored
    window.addEventListener('offline', handleOffline); // Network lost

    // Cleanup: remove event listeners and close the socket when the hook unmounts.
    // This prevents memory leaks and stale listeners on hot-module reloads in dev.
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      socket.disconnect(); // Close the WebSocket connection cleanly
    };
  }, []); // Empty dependency array — only runs once (socket is a singleton for the app)

  // emit: send a named event with optional data to the backend.
  // Wrapped in useCallback so the function reference is stable across renders.
  // Components can safely include emit in dependency arrays without infinite loops.
  const emit = useCallback((event, data) => {
    if (socketRef.current) {
      socketRef.current.emit(event, data); // Forward to Socket.IO emit
    }
  }, []); // No dependencies — socketRef is a ref and never changes

  // on: register an event listener on the socket.
  // Used by ChatContext to subscribe to backend events (new-message, user-joined, etc.)
  const on = useCallback((event, callback) => {
    if (socketRef.current) {
      socketRef.current.on(event, callback); // Register listener
    }
  }, []);

  // off: remove an event listener from the socket.
  // Must be called in useEffect cleanup to prevent memory leaks and duplicate handlers.
  const off = useCallback((event, callback) => {
    if (socketRef.current) {
      socketRef.current.off(event, callback); // Deregister listener
    }
  }, []);

  // Return the socket instance and helpers so ChatContext and components can use them.
  // socket: the raw Socket.IO client (used for accessing socket.id)
  // connected/reconnecting: reactive state for UI indicators
  // emit/on/off: stable, ref-based wrappers for socket operations
  return { socket: socketRef.current, connected, reconnecting, emit, on, off };
}
