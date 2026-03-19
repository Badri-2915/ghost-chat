// =============================================================================
// App.jsx — Root component for Ghost Chat.
// Wraps the app in ChatProvider (context) and renders the appropriate screen
// based on the current state: Landing (create/join), WaitingRoom, or ChatRoom.
// =============================================================================

import { ChatProvider, useChat } from './context/ChatContext';
import Landing from './components/Landing';
import WaitingRoom from './components/WaitingRoom';
import ChatRoom from './components/ChatRoom';

function AppContent() {
  const { screen } = useChat();

  switch (screen) {
    case 'waiting':
      return <WaitingRoom />;
    case 'chat':
      return <ChatRoom />;
    default:
      return <Landing />;
  }
}

export default function App() {
  return (
    <ChatProvider>
      <AppContent />
    </ChatProvider>
  );
}
