# OnlyPeak Backend

Personal, single-user FastAPI backend for OnlyPeak. Wraps `yt-dlp` (search,
resolve, audio) and `ffmpeg` (clip extraction). No auth — this is a private tool
(see `OnlyPeak-build-spec.md`, Sections 0/6/12).

Requires **Python 3.11+**.

## Setup

Create and activate a virtual environment, then install dependencies.

### 1. Create the venv

```bash
py -m venv .venv
```

(`py` is the Windows Python launcher. On Linux/macOS use `python3 -m venv .venv`.)

### 2. Activate it

Windows (PowerShell):

```powershell
.\.venv\Scripts\Activate.ps1
```

Windows (cmd):

```cmd
.\.venv\Scripts\activate.bat
```

macOS / Linux (bash/zsh):

```bash
source .venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

## Run

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

`--host 0.0.0.0` exposes the server on your LAN so the phone (PWA) can reach it.
CORS is preconfigured to allow `localhost`, `127.0.0.1`, and private LAN ranges
(`10.*`, `192.168.*`, `172.16-31.*`) on any port.

You can also just run the module directly:

```bash
python main.py
```

## Endpoints

| Method | Path                                   | Description                                  |
|--------|----------------------------------------|----------------------------------------------|
| GET    | `/api/health`                          | `{"ok": true}`                               |
| GET    | `/api/search?q=<query>&limit=15`       | Search results (400 if `q` missing)          |
| GET    | `/api/resolve/{videoId}`               | Metadata + most-replayed `heatmap` (or null) |
| GET    | `/api/audio/{videoId}`                 | Range-aware audio proxy (for `<audio>`)      |
| GET    | `/api/clip/{videoId}?start=&end=`      | ffmpeg-clipped `audio/mp4` (offline caching) |

Quick check:

```bash
curl http://localhost:8000/api/health
curl "http://localhost:8000/api/search?q=daft%20punk&limit=5"
```

## Requirements / notes

- **ffmpeg must be on PATH** for `/api/clip`. If it isn't, that endpoint
  returns `503 {"error": "ffmpeg not installed"}` and the rest of the app still
  works (online streaming via `/api/audio`).
  - Windows: install via `winget install Gyan.FFmpeg` (or download a static
    build and add its `bin` to PATH).
  - macOS: `brew install ffmpeg`. Debian/Ubuntu: `sudo apt install ffmpeg`.

- **Keep `yt-dlp` updated.** It breaks whenever YouTube changes its internals.
  When search/resolve/audio suddenly start failing, update it first:

  ```bash
  pip install -U yt-dlp
  ```

  All `yt-dlp` logic is isolated in `youtube.py` so breakage stays localized.

- **Never expose this publicly.** Using `yt-dlp` against YouTube is acceptable
  here only because it's a private, single-user tool.
