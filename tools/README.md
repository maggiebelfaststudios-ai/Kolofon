# Video optimisation

Clips recorded on a phone come out at around 20 Mbps. That is a good archival
bitrate and a bad one to serve — roughly five times what the same picture needs
in a browser. The homepage was carrying 43 MB of video because of it.

This is about **bitrate, not resolution**. A 1080x1920 clip stays 1080x1920.

## One-time setup

```
winget install --id Gyan.FFmpeg -e
git config core.hooksPath .githooks
```

Reopen the terminal afterwards so `ffmpeg` is on the PATH. The second line is
per-clone, so it needs running again if the repo is ever cloned fresh.

## After that it is automatic

Committing a `.mp4`, `.mov`, `.m4v` or `.webm` runs `.githooks/pre-commit`,
which optimises the file **before** it is recorded. That ordering matters: git
keeps every version of every file forever, so a large clip committed first and
shrunk afterwards leaves its full size in the repository permanently.

The original is moved to `_originals/` next to it, which is gitignored. Nothing
is ever overwritten in place.

If ffmpeg is not installed the hook says so and lets the commit through, so it
can never block work.

## Running it by hand

For anything not going through git — product videos uploaded on the admin page,
for instance — run it directly first:

```
node tools/optimise-video.mjs path/to/clip.mp4
```

Options:

| Flag | Effect |
| --- | --- |
| `--keep-audio` | Keeps the soundtrack. Off by default, because every clip on the site plays muted. |
| `--crf N` | Quality, 18–28. Lower is better and bigger. Defaults to 23. |
| `--force` | Re-encodes a file already marked as optimised. |

## What it does

- **Caps the bitrate** via CRF rather than resizing, so the picture keeps its
  detail.
- **Moves the index to the front** (`+faststart`). Without this a browser must
  download much of the file before it can show one frame — the main reason a
  phone-exported clip is slow to start even on a fast connection.
- **Drops the audio track**, since every clip here is played muted.
- **Caps the long edge at 1920 and short at 1080**, in case something larger
  ever gets dropped in. Anything already inside that is left at its own size.
- **Keeps the original** if the re-encode somehow comes out bigger.
