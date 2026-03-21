# S.E.A.M Audio Audition

**S.E.A.M** (Segmented Evaluation & Audition Module) is a **local, browser-based** audio audition tool for **dynamic and branching music** delivered as multiple WAV files. You point it at a folder on disk; it **never uploads** your audio.

## What it does

- **Loads structured sample packs** — Expect a root folder that contains a `wav/` directory. Under `wav/`, each subfolder is a **song**. Inside each song folder, WAV files follow a simple naming scheme so the app can infer **parts**, **branch targets**, and optional **full-mix** files.
- **Builds a playable timeline** — Segments are arranged into an ordered sequence (with sensible defaults from your filenames). You can **reorder bricks**, **insert** segments from a file list, and audition the result with a full **seek bar**, **per-part loop** options where the data allows, and **playlist auto-advance** with optional **crossfades** between songs.
- **Plays multiple tracks at once** — Useful for comparing or layering cues.
- **Exports audio** — Stitch the current timeline to **WAV**, **MP3**, or **OGG**, or download individual files. MP3 uses **lamejs**; OGG uses **Vorbis** (encoder scripts may load from a CDN on first use). Very long stitched previews are capped at **60 minutes**.
- **Remembers your session** — Playlist order, edits, loops, crossfade, playback speed, export choices, and encoding preferences are stored in **`localStorage`** per project folder; recent folder handles use **IndexedDB** so you can reopen projects from the welcome screen.

## Requirements

- A **Chromium-based** browser with the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) (e.g. Chrome or Edge).
- Sample packs laid out as described in the in-app **Help** (gear icon and **Help** button in the header after loading).

## How to run

There is no build step. Open `_demo/index.html` in the browser (for folder picking, prefer opening via **http://** from a local static server rather than `file://`, depending on browser security rules).

Example with Python:

```bash
cd _demo
python -m http.server 8080
```

Then visit `http://localhost:8080` and use **Select Folder** to choose your pack’s root directory.

## Repository layout

- **`_demo/`** — The web app (HTML, CSS, JavaScript). This is the runnable UI.
- **`Brief.txt`** — Original product notes (reference).

For full behaviour, UI details, and the exact **file naming** rules, open the app and read **Help** in the header.
