// src/main.jsx
// App entry: mount React and register the PWA service worker. The SW registration
// is wrapped in try/catch (and guarded for the virtual module) so running the dev
// server without a generated service worker never throws at boot.

import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register the service worker for installability + offline. virtual:pwa-register
// is provided by vite-plugin-pwa at build/dev time.
try {
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({ immediate: true });
    })
    .catch(() => {
      /* SW unavailable (e.g. plugin disabled) — app still works online. */
    });
} catch {
  /* dynamic import unsupported — ignore. */
}
