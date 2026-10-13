# Radio Go Go

A personal music streaming server: a small Go binary that serves your own audio files and a single-page web app to
browse, filter and play them. No database, no build step, no external services.

- **Tags as the source of truth.** Artist, album, title, track number, comment and cover art are read straight from
  the embedded tags (ID3 etc.) of the files in `media/` on every request.
- **Albums.** Tracks are grouped by album artist and album, so compilations stay together.
- **Filter.** Case-insensitive search over artist, album, title, comment and chapter titles. `Ctrl+F` focuses the
  filter, `Enter` jumps to the next match, `Esc` clears it.
- **Chapters as bookmarks.** ID3v2 chapters show up as clickable timestamps that seek within the track. Add one at
  the current position with the bookmark button.
- **Upload and edit.** Upload MP3s and edit their tags and chapters in the browser. Files are stored under the
  SHA-256 hash of their content, so duplicates are rejected.
- **Offline playback.** Individual tracks can be stored for offline use through a service worker, and the app is
  installable as a PWA.
- **Media keys.** Previous/next track via the Media Session API.
- **Single binary.** The frontend is embedded at build time.

## Requirements

- Go 1.23+
- [just](https://github.com/casey/just) (optional, for the commands below)
- `ffmpeg` (only for `just cbr`)

## Usage

Put audio files into `media/` and run:

```sh
just run
```

The server listens on `127.0.0.1:1984`. To build a release binary:

```sh
just dist   # writes dist/radio
```

Run the binary from a directory containing `media/`. Put a reverse proxy with HTTPS and authentication in front of
it if you expose it beyond localhost; the server itself has no access control.

## Endpoints

| Method  | Path                    | Description                          |
| ------- | ----------------------- | ------------------------------------ |
| `GET`   | `/`                     | Web app                              |
| `GET`   | `/api/media`            | JSON list of all tracks              |
| `POST`  | `/api/media`            | Upload audio files                   |
| `PATCH` | `/api/media/{fileName}` | Edit tags and chapters of a track    |
| `GET`   | `/media/{fileName}`     | Raw audio file                       |

## Tools

- `just cbr [-n] [-b kbit/s] [files...]` re-encodes VBR MP3s to CBR in place so seeking to timestamps is exact.
  Tags are preserved, `-n` is a dry run.
- `just migrate-chapters [-n] [files...]` moves legacy `HH:MM:SS;<title>` lines from ID3 comments into chapter
  frames.
- `just update` updates the Go dependencies.

## Notes

- The web UI is in English.
- `media/` file names are opaque hashes and are never renamed; tag edits rewrite files in place.

# AI assistance

Parts of this project were written with AI assistance. The models involved:

- Claude Sonnet/Opus

## License

[MIT](LICENSE)
