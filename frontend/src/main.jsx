// React is required for JSX transformation (even though not explicitly used as a variable)
import React from 'react';

// ReactDOM provides the bridge between React's virtual DOM and the actual browser DOM
import ReactDOM from 'react-dom/client';

// App is the root component — wraps everything in ChatProvider and routes screens
import App from './App';

// Global CSS: Tailwind base/components/utilities + custom Ghost Chat styles (animations, glass-card, etc.)
import './index.css';

// createRoot: React 18's concurrent mode API — replaces the older ReactDOM.render()
// document.getElementById('root'): the <div id="root"> in index.html that React mounts into
ReactDOM.createRoot(document.getElementById('root')).render(
  // StrictMode: enables extra runtime checks in development only (double-renders, deprecated API warnings)
  // Has no effect in production builds
  <React.StrictMode>
    <App /> {/* Root component — all screens and state flow through here */}
  </React.StrictMode>
);
