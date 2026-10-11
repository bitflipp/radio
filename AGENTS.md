# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Radio Go Go: a personal music streaming server. A Go HTTP server reads audio files with embedded tags (ID3 etc.)
from a local `media/` directory and serves a single-page Vue app that lists/filters tracks and plays them via an
HTML5 `<audio>` element.

## Commands

- `just run` — run the server locally (`go run .`), listens on `127.0.0.1:1984`.
- `just dist` — clean and build a release binary to `dist/radio`.
- `just clean` — remove `dist/`.
- `linux/scripts/download-radio-media` — rsync `media/` down from the production host (`radio@phinau.de:/home/radio/media/`) for local testing. `media/` is gitignored.
- `just cbr [-n] [-b kbit/s] [files...]` — re-encode VBR MP3s (default `media/*.mp3`) to CBR in place via `ffmpeg`
  (`cmd/cbr`), so browser seeking to timestamps is exact. Original ID3 tags are copied byte for byte; CBR files are
  skipped; `-n` is a dry run.
- `just migrate-chapters [-n] [files...]` — one-off: move legacy `HH:MM:SS;<title>` segment lines out of ID3
  comments into chapter frames (`cmd/migrate-chapters`).
- `just update` — `go get -u ./...` then `go mod tidy`.
- `linux/scripts/deploy-radio` — build and ship the binary to the production host via `scp`/`ssh`, restarting the `radio` systemd service.

No test suite, linter, or formatter config exists for Go. `static/.prettierrc` configures Prettier (2-space tabs,
120 print width) for the frontend files if formatting them.

## Architecture

- **`main.go`** — the entire backend, single file:
  - `readMedia()` scans `mediaRoot` (`./media`), reads tags from each file via `github.com/dhowden/tag`, and sorts
    results by album key (album artist, falling back to artist, + album) then track number. Files with unreadable tags still get an entry
    (`Title: "[filename]"`) rather than being skipped.
  - `GET /api/media` returns the JSON array of `media` structs.
  - `GET /media/<file>` serves raw audio files straight from `mediaRoot` via `http.FileServer`.
  - `GET /` serves the frontend from `static/`, embedded into the binary at build time via `//go:embed static`
    (`static/` is not read from disk at runtime).
- **`static/`** — the frontend, no build step, no npm/package.json. `vue.js` is a vendored copy of Vue loaded as
  an ES module directly in the browser by `index.html`. All app logic lives in `index.js`'s single `setup()`
  function (Vue Composition API), rendering into `index.html`'s inline template.
  - Chapters (used as bookmarks) are ID3v2 `CHAP` frames plus a `CTOC`, read/written by the `chapters` package and
    returned as `chapters: [{start, title}]` (seconds). They render as clickable timestamps that seek the `<audio>`
    element (`onChapterClick`). The editor shows them as time/title rows; the player's bookmark button (or the
    editor's add button while the track plays) inserts one at the current position. On save the client also sends
    the file's duration, which becomes the last chapter's end time. The `comment` field is a plain comment.
  - The track list is grouped into albums by the same album key the backend sorts by, so compilations stay together
    when their tracks share an album artist (TPE2). Mixed-artist groups show each track's artist.
  - `filteredMedia` is a case-insensitive substring filter over artist+album+title+comment+chapter titles; the currently active
    track is always kept visible regardless of the filter. Ctrl+F focuses the filter input; Enter in the filter
    advances to the next match; Escape clears it.
  - Media Session API (`navigator.mediaSession`) wires prev/next track to OS/media-key controls.

## Notes

- Everything (album art aside) is derived from file tags read on every `/api/media` request — there is no
  database and no caching layer.
- `media/` file names are opaque: `saveUploadedFile` names each upload after the sha256 hash of its bytes
  (`<hash>.mp3`), not the uploaded name. They carry no meaning and are never renamed — tag edits (`writeTags`)
  rewrite the file in place — and a byte-identical re-upload is rejected as a duplicate. Existing files predating
  this scheme keep whatever name they already had.
- The frontend is served in German (`<html lang="de">`); keep that if adding UI text.
