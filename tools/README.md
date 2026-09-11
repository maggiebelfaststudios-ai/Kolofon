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

**Videos** are re-encoded with WebCodecs to H.264 at 3.5 Mbps, capped at
1920x1080, with the index moved to the front — the same treatment the desktop
tool gives. It is slow - several minutes for a clip of a few seconds, because
the encoder in the browser is - and it is allowed to take as long as it needs.

Frames are reached by **seeking** to each one in turn, not by playing the clip
and catching frames as they are painted. Playing was tried first and lost a
quarter of the frames on a real upload: under the load of encoding, the browser
skips painting some, and an unpainted frame is never reported. A seek lands on
every timestamp asked for, so none can go missing.

The encoding is **Constrained Baseline** H.264. High profile was tried first; the
browser's hardware encoder used B-frames, which hand frames back out of order,
and the muxer rejects that. Baseline cannot contain them.

## It always falls back

Every failure hands the original file back and lets the upload continue, so the
worst case is that nothing was saved:

- browser missing WebCodecs, `createImageBitmap`, or `requestVideoFrameCallback`
- the CDN muxer failing to load
- no Constrained Baseline H.264 encoder at any of the levels tried
- a file the browser cannot decode, HEIC being the likely one
- a PNG on a browser with no WebP encoder — JPEG would lose its transparency
- a result that came out **larger** than the original
- a capture that did not reach every frame
- a malformed avcC record from the encoder, with no correct copy in the keyframe
  to rebuild it from
- a video whose re-encode does not come back the same length

That last one is the important one. A clip that encodes but plays for two
seconds instead of fifteen would be worse than no saving at all, so the output
is loaded back and its duration checked before it is trusted.

Run `node tools/test-media-optimiser.mjs` to exercise those paths, and
`node tools/test-video-capture.mjs` to simulate the capture loop itself - a
frozen capture, an encoder that falls behind, a clip that ends, and a tab that
is hidden for a long time and then brought back.

The capture test runs against the **real** mp4-muxer, fetched from the URL
admin.html pins, so it needs a network connection. A fake muxer was tried first
and accepted chunks the real one rejects - which let the bug that broke the first
live upload through.

## The avcC record

The encoder in at least one browser writes the first byte of the SPS and PPS
twice in the avcC record it hands back. ffmpeg recovers by using the copies
inside the keyframe, but Apple's decoder builds itself from the record, so an
iPhone could fail to play the file. The record is checked on every upload and
rebuilt from the keyframe when it does not hold together; the console log shows
`avcCRepaired: true` when that happened.

## Waiting, and switching tabs

A slow capture is never cut off. The only thing that ends one early is a
genuine freeze: the tab in front and still no progress for a full 60 seconds.

**Switching to another tab pauses the job.** No frames are taken while the tab
is hidden, because a hidden page may not refresh the picture a seek lands on,
and capturing then could record the same image over and over with nothing to
flag it. Time away is not counted against the job; it carries on from where it
stopped when the tab comes back. So leaving is safe - it just does not make
progress while you are gone.

The admin page logs what happened to each file in the browser console.
