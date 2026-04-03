// =============================================================================
// App.jsx — Root component for Ghost Chat.
// Wraps the app in ChatProvider (context) and renders the appropriate screen
// based on the current state: Landing (create/join), WaitingRoom, or ChatRoom.
// =============================================================================

// ChatProvider: wraps the app in the ChatContext — provides all state and actions to children
// useChat: hook that reads the current context value (screen, userId, messages, etc.)
import { ChatProvider, useChat } from './context/ChatContext';

// Landing: the entry screen where users create or join a room
import Landing from './components/Landing';

// WaitingRoom: shown while waiting for creator approval after submitting a join request
import WaitingRoom from './components/WaitingRoom';

// ChatRoom: the main chat interface with messages, input, sidebar, and controls
import ChatRoom from './components/ChatRoom';

// AppContent reads the 'screen' value from ChatContext and renders the correct view.
// This component must be inside ChatProvider so it can call useChat().
// Screen values: 'landing' (default) | 'waiting' (pending approval) | 'chat' (active room)
function AppContent() {
  const { screen } = useChat(); // Read current screen from global chat state

  switch (screen) {
    case 'waiting':
      return <WaitingRoom />; // Join request submitted, awaiting creator approval
    case 'chat':
      return <ChatRoom />;    // Approved and inside the room
    default:
      return <Landing />;     // Initial state — create or join a room
  }
}

// App is the root component exported from this file.
// It wraps everything in ChatProvider so the entire component tree has access to chat state.
// AppContent is a separate inner component so it can call useChat() (which requires a Provider ancestor).
export default function App() {
  return (
    <ChatProvider>
      <AppContent /> {/* Reads context and routes to correct screen */}
    </ChatProvider>
  );
}
