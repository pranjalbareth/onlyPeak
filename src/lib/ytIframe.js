// src/lib/ytIframe.js
// Shared singleton loader for the YouTube IFrame Player API. The PeakEditor's
// preview player uses this; the global PlayerEngine has its own equivalent
// loader, and both guard on window.YT so the script is only injected once.
// Resolves to window.YT once YT.Player is available.

let _ready = null;

export function loadYTApi() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (_ready) return _ready;
  _ready = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') {
        try { prev(); } catch { /* ignore a prior callback throwing */ }
      }
      resolve(window.YT);
    };
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      document.head.appendChild(s);
    }
  });
  return _ready;
}
