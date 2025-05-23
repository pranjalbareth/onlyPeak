import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { PlaylistProvider } from './context/PlaylistContext';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PlaylistProvider>
      <App />
    </PlaylistProvider>
  </React.StrictMode>
);
