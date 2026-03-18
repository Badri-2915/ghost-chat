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
