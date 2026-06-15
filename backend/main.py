"""
OnlyPeak personal backend — FastAPI app.

Single-user, no auth (build-spec Section 0/6). All yt-dlp logic lives in
youtube.py so YouTube breakage stays localized. This module is the HTTP layer:
search, resolve, a Range-aware audio proxy, and an ffmpeg-based clip endpoint.

Run:
    uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""

import os
import shutil
import asyncio
import tempfile

import httpx
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse
from starlette.background import BackgroundTask

import youtube


app = FastAPI(title="OnlyPeak Backend", version="1.0.0")


# ---------------------------------------------------------------------------
# CORS
# Personal app served from localhost during dev and from a LAN IP on the phone.
# Allow:
#   - localhost / 127.0.0.1 on any port
#   - private LAN ranges on any port:
#       10.x.x.x
#       192.168.x.x
#       172.16.x.x - 172.31.x.x
# on http or https. allow_origin_regex lets us match "any port" cleanly.
# ---------------------------------------------------------------------------
_CORS_REGEX = (
    r"^https?://("
    r"localhost"
    r"|127\.0\.0\.1"
    r"|10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
    r"|192\.168\.\d{1,3}\.\d{1,3}"
    r"|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}"
    r")(:\d+)?$"
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=_CORS_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Expose the headers an <audio> element needs to know about for seeking.
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length", "Content-Type"],
)


# How big a chunk to relay while streaming the audio proxy body.
_STREAM_CHUNK = 64 * 1024  # 64 KiB


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@app.get("/api/health")
async def health():
    return {"ok": True}


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------
@app.get("/api/search")
async def search(
    q: str | None = Query(default=None),
    limit: int = Query(default=15, ge=1, le=50),
):
    if not q or not q.strip():
        return JSONResponse(status_code=400, content={"error": "query 'q' is required"})

    try:
        # yt-dlp is blocking; run it off the event loop.
        results = await asyncio.to_thread(youtube.search, q.strip(), limit)
        return results
    except Exception as exc:  # noqa: BLE001 - surface a clean error to the client
        return JSONResponse(status_code=502, content={"error": f"search failed: {exc}"})


# ---------------------------------------------------------------------------
# Resolve
# ---------------------------------------------------------------------------
@app.get("/api/resolve/{video_id}")
async def resolve(video_id: str):
    try:
        data = await asyncio.to_thread(youtube.resolve, video_id)
        return data
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(
            status_code=502, content={"error": f"resolve failed: {exc}"}
        )


# ---------------------------------------------------------------------------
# Audio proxy (Range-aware)
#
# The browser's <audio> element issues Range requests to seek. We:
#   1. resolve the best audio-only googlevideo URL (+ its required http_headers),
#   2. forward the incoming Range header upstream,
#   3. relay the upstream status (200 full, or 206 partial),
#   4. copy Content-Range / Accept-Ranges / Content-Length / Content-Type,
#   5. stream the body in chunks.
# Always advertise Accept-Ranges: bytes so the element knows it can seek.
# ---------------------------------------------------------------------------
@app.get("/api/audio/{video_id}")
async def audio(video_id: str, request: Request):
    try:
        stream = await asyncio.to_thread(youtube.get_audio_stream, video_id)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(
            status_code=502, content={"error": f"could not get audio stream: {exc}"}
        )

    upstream_url = stream["url"]
    upstream_headers = dict(stream.get("http_headers") or {})
    mime = stream.get("mime") or "audio/mp4"

    # Forward the client's Range header (if any) to the upstream.
    range_header = request.headers.get("range")
    if range_header:
        upstream_headers["Range"] = range_header

    client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=None), follow_redirects=True)

    try:
        upstream_req = client.build_request("GET", upstream_url, headers=upstream_headers)
        upstream_resp = await client.send(upstream_req, stream=True)
    except Exception as exc:  # noqa: BLE001
        await client.aclose()
        return JSONResponse(
            status_code=502, content={"error": f"upstream audio fetch failed: {exc}"}
        )

    # Build response headers from the upstream, copying the ones <audio> needs.
    resp_headers = {"Accept-Ranges": "bytes"}
    for h in ("content-range", "content-length"):
        if h in upstream_resp.headers:
            resp_headers[h.title()] = upstream_resp.headers[h]
    content_type = upstream_resp.headers.get("content-type") or mime
    resp_headers["Content-Type"] = content_type

    async def body_iter():
        try:
            async for chunk in upstream_resp.aiter_bytes(_STREAM_CHUNK):
                yield chunk
        finally:
            await upstream_resp.aclose()
            await client.aclose()

    # Relay the upstream status (206 for partial, 200 for full).
    return StreamingResponse(
        body_iter(),
        status_code=upstream_resp.status_code,
        headers=resp_headers,
        media_type=content_type,
    )


# ---------------------------------------------------------------------------
# Clip (ffmpeg) — extract [start, end] as audio/mp4 (aac)
#
# Used for offline caching (client stores the blob in IndexedDB). Requires
# ffmpeg on PATH; if it's missing we return 503 so the client can degrade
# gracefully to online streaming.
# ---------------------------------------------------------------------------
@app.get("/api/clip/{video_id}")
async def clip(
    video_id: str,
    start: float = Query(...),
    end: float = Query(...),
):
    if shutil.which("ffmpeg") is None:
        return JSONResponse(status_code=503, content={"error": "ffmpeg not installed"})

    # Validate the range.
    if start < 0:
        return JSONResponse(status_code=400, content={"error": "start must be >= 0"})
    if start >= end:
        return JSONResponse(status_code=400, content={"error": "start must be < end"})

    try:
        stream = await asyncio.to_thread(youtube.get_audio_stream, video_id)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(
            status_code=502, content={"error": f"could not get audio stream: {exc}"}
        )

    audio_url = stream["url"]

    # Temp output file. Created here, deleted after the response is sent.
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".m4a")
    os.close(tmp_fd)

    # -ss before -i for fast input seeking. With input-side -ss, ffmpeg resets
    # timestamps to 0, so we MUST express the length as a duration (-t), not an
    # absolute -to (which would be measured from the reset timeline and yield a
    # clip ~`end` seconds long instead of `end-start`). -vn drops any video.
    duration = end - start
    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        str(start),
        "-i",
        audio_url,
        "-t",
        str(duration),
        "-vn",
        "-c:a",
        "aac",
        "-f",
        "mp4",
        # mp4 in a non-seekable/streamed context needs faststart-ish flags;
        # writing to a real temp file we can use the default mp4 muxer.
        "-movflags",
        "+faststart",
        tmp_path,
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()

        if proc.returncode != 0 or not os.path.exists(tmp_path) or os.path.getsize(tmp_path) == 0:
            _safe_unlink(tmp_path)
            detail = (stderr or b"").decode("utf-8", "replace")[-500:]
            return JSONResponse(
                status_code=502,
                content={"error": f"ffmpeg failed: {detail.strip() or 'unknown error'}"},
            )
    except Exception as exc:  # noqa: BLE001
        _safe_unlink(tmp_path)
        return JSONResponse(status_code=502, content={"error": f"clip failed: {exc}"})

    # FileResponse streams the file; clean it up once the response is finished.
    # BackgroundTask runs after the FileResponse body has been sent, so the
    # temp clip is cleaned up once the client has it.
    return FileResponse(
        tmp_path,
        media_type="audio/mp4",
        filename=f"{video_id}_{int(start)}-{int(end)}.m4a",
        background=BackgroundTask(_safe_unlink, tmp_path),
    )


def _safe_unlink(path: str):
    try:
        if path and os.path.exists(path):
            os.unlink(path)
    except OSError:
        pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000)
