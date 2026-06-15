"""
All yt-dlp logic lives here and ONLY here.

yt-dlp breaks whenever YouTube changes its internals (see build-spec Section 12).
Isolating every yt-dlp call in this one module means that when extraction breaks,
the fix is localized to a single file. The rest of the backend (main.py) only
talks to the plain dicts these functions return.

Functions:
    search(query, limit)      -> list of compact result dicts
    resolve(video_id)         -> metadata + most-replayed heatmap (or None)
    get_audio_stream(video_id)-> upstream audio URL + headers + mime (INTERNAL ONLY)

Note on stream URLs: get_audio_stream returns a short-lived, IP-bound
googlevideo URL. It is used internally by the /api/audio proxy and the /api/clip
ffmpeg step. It must NEVER be returned to the client (build-spec Section 6 / 12).
"""

import time
import threading

import yt_dlp


# ---------------------------------------------------------------------------
# One shared YoutubeDL instance. yt-dlp recommends reusing an extractor; it also
# avoids re-parsing options on every call. We never download — we only extract
# metadata / format info, so skip_download is on.
# ---------------------------------------------------------------------------
_YDL_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "skip_download": True,
    # Don't abort a whole search/resolve because one item failed.
    "ignoreerrors": True,
    # We do our own client-side error handling; don't print to stderr.
    "noprogress": True,
}

_ydl = yt_dlp.YoutubeDL(_YDL_OPTS)


# ---------------------------------------------------------------------------
# Small in-memory TTL cache for resolve(), keyed by video_id.
# Uses time.monotonic() (NOT wall clock) so system clock changes / NTP jumps
# can't corrupt expiry math. Personal single-user app -> a plain dict + lock.
# ---------------------------------------------------------------------------
_RESOLVE_TTL_SEC = 60 * 30  # 30 minutes
_resolve_cache: dict[str, tuple[float, dict]] = {}
_resolve_lock = threading.Lock()


def _cache_get(video_id: str):
    with _resolve_lock:
        entry = _resolve_cache.get(video_id)
        if entry is None:
            return None
        expires_at, value = entry
        if time.monotonic() >= expires_at:
            # Expired — drop it.
            _resolve_cache.pop(video_id, None)
            return None
        return value


def _cache_put(video_id: str, value: dict):
    with _resolve_lock:
        _resolve_cache[video_id] = (time.monotonic() + _RESOLVE_TTL_SEC, value)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _watch_url(video_id: str) -> str:
    return f"https://www.youtube.com/watch?v={video_id}"


def _thumbnail_for(info: dict, video_id: str) -> str:
    """
    Return a usable thumbnail URL. Prefer the entry's own thumbnail; otherwise
    build the canonical hqdefault URL from the video id.
    """
    thumb = info.get("thumbnail")
    if thumb:
        return thumb

    # Sometimes only a 'thumbnails' list is present; pick the last (largest).
    thumbs = info.get("thumbnails")
    if isinstance(thumbs, list) and thumbs:
        url = thumbs[-1].get("url")
        if url:
            return url

    if video_id:
        return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
    return ""


def _artist_for(info: dict) -> str:
    """artist = uploader / channel, whichever is present."""
    return (
        info.get("uploader")
        or info.get("channel")
        or info.get("uploader_id")
        or info.get("artist")
        or "Unknown"
    )


def _duration_for(info: dict) -> int:
    dur = info.get("duration")
    try:
        return int(dur) if dur is not None else 0
    except (TypeError, ValueError):
        return 0


def _compact(info: dict) -> dict:
    """Map a yt-dlp info/entry dict to the public Song shape (Section 5/6)."""
    video_id = info.get("id") or info.get("videoId") or ""
    return {
        "videoId": video_id,
        "title": info.get("title") or "Untitled",
        "artist": _artist_for(info),
        "durationSec": _duration_for(info),
        "thumbnailUrl": _thumbnail_for(info, video_id),
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def search(query: str, limit: int = 15) -> list[dict]:
    """
    Search YouTube via ytsearch and return compact result rows.

    Uses extract_flat='in_playlist' so yt-dlp does NOT resolve every video's
    full format list — it just returns the flat search-result entries. This is
    much faster (one network round trip instead of N).
    """
    search_url = f"ytsearch{int(limit)}:{query}"

    # extract_flat is a construction-time option, so flat extraction uses a
    # transient YoutubeDL (see _ydl_extract_flat) rather than the shared one.
    info = _ydl_extract_flat(search_url)

    if not info:
        return []

    entries = info.get("entries") or []
    results: list[dict] = []
    for entry in entries:
        if not entry:
            continue
        results.append(_compact(entry))
    return results


def _ydl_extract_flat(search_url: str):
    """
    Run a flat extraction (extract_flat='in_playlist'). We build a transient
    YoutubeDL with the flat option layered on top of the shared opts, because
    extract_flat is a construction-time option in yt-dlp.
    """
    opts = dict(_YDL_OPTS)
    opts["extract_flat"] = "in_playlist"
    with yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info(search_url, download=False)


def resolve(video_id: str) -> dict:
    """
    Full resolve of a single video: metadata + most-replayed heatmap.

    heatmap: yt-dlp exposes a 'heatmap' key (list of dicts with start_time,
    end_time, value) when the Most Replayed graph is available. We map it to
    [{startSec, endSec, value}] with value in 0..1. If absent/empty -> None,
    and the client falls back to a default window (Section 7).

    Cached in-memory (TTL, monotonic clock) to avoid re-resolving the same id.
    """
    cached = _cache_get(video_id)
    if cached is not None:
        return cached

    info = _ydl.extract_info(_watch_url(video_id), download=False)
    if not info:
        raise RuntimeError(f"Could not resolve video '{video_id}'")

    result = _compact(info)

    # --- heatmap ---
    heatmap = None
    raw_heatmap = info.get("heatmap")
    if isinstance(raw_heatmap, list) and raw_heatmap:
        mapped = []
        for seg in raw_heatmap:
            if not isinstance(seg, dict):
                continue
            start = seg.get("start_time")
            end = seg.get("end_time")
            value = seg.get("value")
            if start is None or end is None or value is None:
                continue
            try:
                mapped.append(
                    {
                        "startSec": float(start),
                        "endSec": float(end),
                        "value": float(value),
                    }
                )
            except (TypeError, ValueError):
                continue
        if mapped:
            heatmap = mapped

    result["heatmap"] = heatmap

    _cache_put(video_id, result)
    return result


def get_audio_stream(video_id: str) -> dict:
    """
    Resolve the best audio-only format and return what the proxy needs:
        { "url": <direct googlevideo url>, "http_headers": {...}, "mime": "audio/..." }

    INTERNAL ONLY. The url is short-lived and IP-bound — it must never be
    returned to the client. main.py uses it to proxy-stream and to feed ffmpeg.
    """
    # 'bestaudio' selects the best audio-only stream. We build a transient
    # YoutubeDL with the format selector so the shared instance stays generic.
    opts = dict(_YDL_OPTS)
    opts["format"] = "bestaudio"

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(_watch_url(video_id), download=False)

    if not info:
        raise RuntimeError(f"Could not resolve audio for video '{video_id}'")

    # When a format selector is applied, yt-dlp sets info['url'] to the chosen
    # format's URL and merges 'requested_formats' for split a/v. For bestaudio
    # we expect a single audio format.
    fmt = None
    requested = info.get("requested_formats")
    if requested:
        # Pick the audio one (vcodec none) if present, else the first.
        for f in requested:
            if f.get("vcodec") in (None, "none"):
                fmt = f
                break
        if fmt is None:
            fmt = requested[0]

    if fmt is None:
        # Single chosen format is flattened onto info itself.
        fmt = info

    url = fmt.get("url")
    if not url:
        raise RuntimeError(f"No audio stream URL for video '{video_id}'")

    http_headers = fmt.get("http_headers") or {}

    # --- mime guess ---
    ext = (fmt.get("ext") or "").lower()
    acodec = (fmt.get("acodec") or "").lower()
    if ext == "webm" or "opus" in acodec or "vorbis" in acodec:
        mime = "audio/webm"
    else:
        # m4a / mp4 / aac and anything else default to mp4 container.
        mime = "audio/mp4"

    return {
        "url": url,
        "http_headers": dict(http_headers),
        "mime": mime,
    }
