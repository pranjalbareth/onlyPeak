// src/lib/youtube.js
// Direct YouTube Data API v3 client (no backend). Used by libraryStore.search()
// to turn a text query into Song results. Requires VITE_YOUTUBE_API_KEY (see
// .env.example). Playback itself uses the public IFrame player and needs no key.

const API_KEY = import.meta.env.VITE_YOUTUBE_API_KEY || '';
const BASE = 'https://www.googleapis.com/youtube/v3';

/** Parse an ISO-8601 duration (PT#H#M#S) into seconds. */
function parseDuration(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
  if (!m) return 0;
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}

async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) {
    let msg = `YouTube API error ${res.status}`;
    try {
      const j = await res.json();
      if (j?.error?.message) msg = j.error.message;
    } catch {
      /* keep status-line message */
    }
    throw new Error(msg);
  }
  return res.json();
}

/**
 * Search YouTube (Music category) and return Song[] enriched with durations.
 * @param {string} q
 * @param {number} [limit=15]
 * @returns {Promise<Array<{videoId,title,artist,durationSec,thumbnailUrl}>>}
 */
export async function searchSongs(q, limit = 15) {
  if (!API_KEY) {
    throw new Error('Search needs a YouTube API key. Add VITE_YOUTUBE_API_KEY to your .env file.');
  }
  const searchUrl =
    `${BASE}/search?part=snippet&type=video&videoCategoryId=10` +
    `&maxResults=${limit}&q=${encodeURIComponent(q)}&key=${API_KEY}`;
  const data = await apiGet(searchUrl);
  const items = (data.items || []).filter(
    (i) => i.id?.videoId && i.snippet?.liveBroadcastContent === 'none'
  );
  if (items.length === 0) return [];

  // Batch one videos.list call to fill in durations.
  const ids = items.map((i) => i.id.videoId).join(',');
  const durMap = {};
  try {
    const d = await apiGet(`${BASE}/videos?part=contentDetails&id=${ids}&key=${API_KEY}`);
    for (const item of d.items || []) {
      durMap[item.id] = parseDuration(item.contentDetails?.duration || '');
    }
  } catch {
    /* durations default to 0; the editor fills them in from the IFrame player */
  }

  return items.map((item) => {
    const sn = item.snippet;
    return {
      videoId: item.id.videoId,
      title: decodeEntities(sn.title || 'Unknown'),
      artist: decodeEntities(sn.channelTitle || 'Unknown'),
      durationSec: durMap[item.id.videoId] || 0,
      thumbnailUrl:
        sn.thumbnails?.high?.url ||
        sn.thumbnails?.medium?.url ||
        sn.thumbnails?.default?.url ||
        `https://i.ytimg.com/vi/${item.id.videoId}/hqdefault.jpg`,
    };
  });
}

// YouTube snippet titles arrive HTML-entity-encoded (&amp;, &#39;, &quot;…).
function decodeEntities(s) {
  if (!s || s.indexOf('&') === -1) return s;
  const el = document.createElement('textarea');
  el.innerHTML = s;
  return el.value;
}
