# 🎵 OnlyPeak — Snippet-Powered Music Playlist App

OnlyPeak is a web-first, mobile-friendly music player focused on *the best parts* of every track — the peaks. Whether it's that explosive chorus, iconic drop, or feel-good bridge, OnlyPeak lets you create, collect, and vibe to just the most powerful snippets.

## 🚀 Live Demo

[🔗 Try OnlyPeak Now](#) *(Coming Soon)*

---

## ✨ Current Features

* 🎬 **YouTube Integration** — Play music directly from YouTube.
* 🔥 **Custom Snippet Playback** — Define start and end times for peak moments.
* ⏯️ **Play / Pause Controls** — Basic playback control with snippet looping.
* 🧭 **Seek Within Snippet** — Users can navigate within the selected range.
* 🖼️ **Video Thumbnails + Metadata** — Displays thumbnail, title, and artist.
* 🌈 **Dynamic Accent Color** — Extracts accent color from thumbnail using ColorThief.
* 📱 **Mobile-First Responsive UI** — Built for both mobile and desktop browsers.

---

## 🛣️ Upcoming Features (Planned)

* 💾 **User Accounts + Saved Snippets** — Sign in and save your personalized snippet playlists.
* 📃 **Snippet Playlists** — Queue multiple snippets into a smooth flow.
* 🧠 **AI Snippet Suggestion** — Auto-suggest best parts of songs using ML models.
* 🟢 **Spotify Integration** — Stream and create snippet playlists from Spotify tracks.
* 🎧 **Offline Mode** — Save snippet sessions for offline playback.
* 🖌️ **Theme Customization** — Light/dark modes and user-picked color themes.
* 🧩 **Embeddable Player** — Drop your snippet playlist into blogs and portfolios.
* ⚙️ **Advanced Player Controls** — Fine-tune loop, playback rate, volume fades.

---

## 🛠️ Tech Stack

* **Frontend**: React + Vite
* **Styling**: Tailwind CSS
* **Media**: YouTube iFrame API
* **Color Detection**: ColorThief
* **Design**: Mobile-first responsive layout

---

## 🚀 Getting Started

```bash
npm install
npm run dev          # http://localhost:5180 (or the port Vite prints)
```

Search uses the YouTube Data API, so create a `.env` (copy from `.env.example`):

```bash
VITE_YOUTUBE_API_KEY=your_youtube_data_api_v3_key
```

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_YOUTUBE_API_KEY` | for search | YouTube Data API v3 key used by in-app search. Playback uses the public IFrame player and needs no key. |

> **Secure-origin note:** the YouTube IFrame player only plays on a secure context — `https://` or `localhost`. Opening the dev server on a phone via a raw `http://<LAN-IP>` address shows "Video Unavailable". To test on a phone locally, run `HTTPS=true npm run dev -- --host` (self-signed cert) **with a hostname**, or just use the HTTPS production URL.

## 📦 Deployment (Vercel)

OnlyPeak is a static Vite SPA with no backend — deploy as-is:

- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Env var:** set `VITE_YOUTUBE_API_KEY` in the Vercel project settings.

Playlists and peaks are stored locally in the browser (IndexedDB). Production is served over HTTPS, so mobile playback works there.

---

## 📂 Folder Structure (WIP)

```
/src
├── components     # UI Components
├── hooks          # Custom React Hooks
├── utils          # Helper functions
├── constants      # Static config (colors, modes, etc.)
├── assets         # Images, icons, etc.
└── App.jsx        # Main app entry point
```

---

## 🤝 Contributing

Pull requests are welcome! If you have ideas for features, improvements, or bug fixes, feel free to open an issue or PR.

---

## 📢 Stay Tuned

We're just getting started. Follow along as OnlyPeak evolves into *the* way to relive the best of music.

> "Why play the whole song when you only need the high? 🎚️"

---

## 📜 License

MIT License © 2025 OnlyPeak
