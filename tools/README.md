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

---

# Product media (admin page)

Product photos and videos never pass through git — they go from the admin page
straight into Supabase storage, so the hook above never sees them. They are
handled instead by `media-optimiser.js`, which runs in the browser just before
the upload starts. Nothing to remember; saving a product does it.

**Photos** are drawn to a canvas at no more than 2000px on the long edge and
re-encoded as WebP at quality 0.82. EXIF rotation is applied while decoding, so
a portrait photo cannot arrive on its side.

**Videos** are re-encoded with WebCodecs to H.264 at 2.5 Mbps, capped at
1920x1080, with the index moved to the front — the same treatment the desktop
tool gives. Frames are taken as they play, so a 15-second clip takes about
15 seconds.

## It always falls back

Every failure hands the original file back and lets the upload continue, so the
worst case is that nothing was saved:

- browser missing WebCodecs, `createImageBitmap`, or `requestVideoFrameCallback`
- the CDN muxer failing to load
- no H.264 encoder (checked with `VideoEncoder.isConfigSupported`)
- a file the browser cannot decode, HEIC being the likely one
- a PNG on a browser with no WebP encoder — JPEG would lose its transparency
- a result that came out **larger** than the original
- a video whose re-encode does not come back the same length

That last one is the important one. A clip that encodes but plays for two
seconds instead of fifteen would be worse than no saving at all, so the output
is loaded back and its duration checked before it is trusted.

Run `node tools/test-media-optimiser.mjs` to exercise those paths.

The admin page logs what happened to each file in the browser console.
