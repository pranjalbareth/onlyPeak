// src/lib/ytUrl.js
// Parse a YouTube video id out of a pasted URL so the search bar can skip text
// search and jump straight to /resolve (build-spec Section 8, Phase 6).
//
// Deliberately strict: we only accept things that actually look like a YouTube
// URL (host contains youtu.be / youtube.com). We do NOT treat a bare 11-char
// token as an id, because ordinary search queries ("playstation") can be 11
// id-legal characters and would be mis-routed to resolve.

const ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Extract an 11-char YouTube video id from a pasted URL, or null if `text`
 * isn't a recognizable YouTube link.
 * @param {string} text
 * @returns {string|null}
 */
export function parseVideoId(text) {
  const s = (text || '').trim();
  if (!s) return null;
  // Must look like a YouTube link before we bother parsing.
  if (!/youtu\.?be/i.test(s)) return null;

  let url;
  try {
    url = new URL(s.startsWith('http') ? s : `https://${s}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '').replace(/^music\./, '');

  // youtu.be/<id>
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return ID_RE.test(id) ? id : null;
  }

  if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    // watch?v=<id>
    const v = url.searchParams.get('v');
    if (v && ID_RE.test(v)) return v;
    // /shorts/<id>, /embed/<id>, /live/<id>
    const m = url.pathname.match(/\/(?:shorts|embed|live|v)\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
  }

  return null;
}

/** True if `text` is a parseable YouTube URL. */
export function isVideoUrl(text) {
  return parseVideoId(text) !== null;
}
