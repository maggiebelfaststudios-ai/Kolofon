/**
 * Shrinks media in the browser, on its way to being uploaded.
 *
 * Product photos and videos do not go through git, so the pre-commit hook that
 * handles the home page clips never sees them. They go straight from the admin
 * page into Supabase storage, which means the only place left to intervene is
 * here, before the upload starts.
 *
 * Everything in here is written to fail safe. If a browser is missing an API,
 * if a decode throws, if the result comes out larger or looks wrong, the
 * original file is handed back untouched and the upload carries on exactly as
 * it did before. The worst case is that nothing is saved.
 */
(function () {
    'use strict';

    // Photos are shown at most a few hundred CSS pixels wide, so 2000 on the
    // long edge is already generous for a high-density screen.
    const MAX_IMAGE_EDGE = 2000;
    const IMAGE_QUALITY = 0.82;

    // Matches what tools/optimise-video.mjs settles on for this footage.
    const MAX_VIDEO_LONG = 1920;
    const MAX_VIDEO_SHORT = 1080;
    const VIDEO_BITRATE = 2_500_000;
    const KEYFRAME_SECONDS = 2;
    const FRAMERATE = 30;

    // How long a visible tab may go without a single new frame before the
    // capture is abandoned. Slow is fine - this only catches a frozen one, and
    // time spent in a background tab is not counted at all.
    const STALL_SECONDS = 60;

    const mb = b => (b / 1048576).toFixed(1) + ' MB';

    /** Swaps a filename's extension, keeping the rest of the name. */
    function rename(name, ext) {
        return name.replace(/\.[^.]+$/, '') + '.' + ext;
    }

    // ---------------------------------------------------------------- images

    async function optimiseImage(file) {
        if (typeof createImageBitmap !== 'function') return null;

        let bitmap;
        try {
            // from-image applies the EXIF rotation. Without it a photo taken in
            // portrait uploads on its side.
            bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch (e) {
            return null; // a format the browser cannot decode, HEIC most likely
        }

        const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
        const width = Math.round(bitmap.width * scale);
        const height = Math.round(bitmap.height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, width, height);
        if (bitmap.close) bitmap.close();

        const encode = type => new Promise(resolve => canvas.toBlob(resolve, type, IMAGE_QUALITY));

        // toBlob quietly falls back to PNG when a type is unsupported, so the
        // blob's own type is the only trustworthy answer about what came out.
        let blob = await encode('image/webp');
        let ext = 'webp';

        if (!blob || blob.type !== 'image/webp') {
            // No WebP encoder. JPEG is only safe for a source that had no
            // transparency to lose in the first place.
            if (file.type !== 'image/jpeg') return null;
            blob = await encode('image/jpeg');
            ext = 'jpg';
            if (!blob || blob.type !== 'image/jpeg') return null;
        }

        if (blob.size >= file.size) return null; // already lean, leave it alone

        return {
            file: new File([blob], rename(file.name, ext), { type: blob.type }),
            note: `${mb(file.size)} → ${mb(blob.size)}`,
        };
    }

    // ---------------------------------------------------------------- videos

    function videoSupported() {
        return typeof window.VideoEncoder === 'function'
            && typeof window.VideoFrame === 'function'
            && typeof window.Mp4Muxer === 'object'
            && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
    }

    /** Loads a file into a detached <video> and waits for its metadata. */
    function loadVideo(file) {
        return new Promise((resolve, reject) => {
            const el = document.createElement('video');
            el.muted = true;
            el.playsInline = true;
            el.preload = 'auto';
            el.src = URL.createObjectURL(file);
            el.onloadedmetadata = () => resolve(el);
            el.onerror = () => reject(new Error('could not be read as video'));
        });
    }

    async function optimiseVideo(file, onProgress) {
        const started = performance.now();
        const stats = { frames: 0, expectedFrames: null, tabWasHidden: false, stopReason: null };

        // Every way out of here used to be a bare return null, so a failed run
        // gave no hint of which check tripped. Each one now says so in the console.
        const fail = reason => {
            console.warn('Video-optimering sprang over: ' + reason, {
                seconds: ((performance.now() - started) / 1000).toFixed(1),
                ...stats,
            });
            return null;
        };

        if (!videoSupported()) return fail('browseren mangler WebCodecs eller muxeren blev ikke indlæst');

        let source;
        try {
            source = await loadVideo(file);
        } catch (e) {
            return fail('filen kunne ikke læses som video');
        }

        const cleanUp = () => URL.revokeObjectURL(source.src);

        const sw = source.videoWidth;
        const sh = source.videoHeight;
        const duration = source.duration;
        if (!sw || !sh || !isFinite(duration) || duration <= 0) {
            cleanUp();
            return fail('videoen har ingen brugbare dimensioner eller varighed');
        }
        stats.expectedFrames = Math.round(duration * FRAMERATE);

        // Cap the long edge at 1920 and the short at 1080, keeping the shape.
        const longEdge = Math.max(sw, sh);
        const shortEdge = Math.min(sw, sh);
        const scale = Math.min(1, MAX_VIDEO_LONG / longEdge, MAX_VIDEO_SHORT / shortEdge);
        // H.264 wants even dimensions
        const width = Math.round(sw * scale / 2) * 2;
        const height = Math.round(sh * scale / 2) * 2;

        const muxer = new window.Mp4Muxer.Muxer({
            target: new window.Mp4Muxer.ArrayBufferTarget(),
            video: { codec: 'avc', width, height, frameRate: FRAMERATE },
            // The same faststart the desktop tool applies: the index goes at the
            // front so playback can begin before the download finishes.
            fastStart: 'in-memory',
            // Frames piped straight from a playing element do not necessarily
            // start at zero, and the muxer's strict mode rejects that.
            firstTimestampBehavior: 'offset',
        });

        let encoderError = null;
        const encoder = new window.VideoEncoder({
            output: (chunk, meta) => {
                try {
                    muxer.addVideoChunk(chunk, meta);
                } catch (e) {
                    encoderError = e;
                }
            },
            error: e => { encoderError = e; },
        });

        const config = {
            codec: 'avc1.640028',       // High profile, level 4.0
            width,
            height,
            bitrate: VIDEO_BITRATE,
            framerate: FRAMERATE,
        };

        try {
            // Not every build ships an H.264 encoder, so ask rather than assume
            const support = await window.VideoEncoder.isConfigSupported(config);
            if (!support || !support.supported) {
                cleanUp();
                return fail('browseren har ingen H.264-encoder til denne opløsning');
            }
            encoder.configure(config);
        } catch (e) {
            cleanUp();
            return fail('encoderen kunne ikke konfigureres: ' + e.message);
        }

        // Shared between the capture and the visibility listener below.
        const clock = { lastFrameAt: performance.now(), hiddenSince: null };

        // A hidden tab stops presenting frames, so the capture waits. That wait
        // is not held against it: whatever time passes in the background is
        // added back when the tab returns, so switching away and coming back
        // later never trips the stall check. This relies on the event rather
        // than on polling, because browsers throttle timers in background tabs
        // and a poll would miss how long the tab was actually away.
        const onVisibility = () => {
            if (document.hidden) {
                stats.tabWasHidden = true;
                clock.hiddenSince = performance.now();
            } else if (clock.hiddenSince !== null) {
                clock.lastFrameAt += performance.now() - clock.hiddenSince;
                clock.hiddenSince = null;
            }
        };
        if (document.hidden) clock.hiddenSince = performance.now();
        document.addEventListener('visibilitychange', onVisibility);

        // Frames are pulled as they are presented, so the encode runs at
        // playback speed. A short product clip is a few seconds of waiting.
        stats.frames = await new Promise(resolve => {
            let count = 0;
            let lastTimestamp = -1;
            let done = false;
            let draining = false;

            // One way to stop. Before this the loop carried on after the clip
            // ended, feeding stray frames to an encoder that was being flushed.
            const finish = why => {
                if (done) return;
                done = true;
                stats.stopReason = why;
                clearInterval(watchdog);
                source.pause();
                resolve(count);
            };

            // Give up only on a capture that is genuinely frozen: the tab is in
            // front, the encoder is not busy, and still no frame has come for a
            // full minute. A slow capture keeps resetting this, and a hidden one
            // is skipped entirely, so waiting it out is always allowed.
            const watchdog = setInterval(() => {
                if (document.hidden || draining) return;
                if (performance.now() - clock.lastFrameAt > STALL_SECONDS * 1000) {
                    finish(`ingen nye billeder i ${STALL_SECONDS} sekunder med fanen åben`);
                }
            }, 1000);

            const onFrame = (now, meta) => {
                if (done) return;
                if (encoderError) return finish('encoderfejl: ' + encoderError.message);
                clock.lastFrameAt = performance.now();

                // Microseconds, and strictly increasing or the encoder rejects it
                let timestamp = Math.round(meta.mediaTime * 1e6);
                if (timestamp <= lastTimestamp) timestamp = lastTimestamp + 1;
                lastTimestamp = timestamp;

                let frame;
                try {
                    frame = new window.VideoFrame(source, { timestamp });
                } catch (e) {
                    return finish('billede kunne ikke læses: ' + e.message);
                }

                const isKeyFrame = count % Math.round(FRAMERATE * KEYFRAME_SECONDS) === 0;
                try {
                    encoder.encode(frame, { keyFrame: isKeyFrame });
                } catch (e) {
                    frame.close();
                    return finish('encode fejlede: ' + e.message);
                }
                frame.close();
                count++;

                if (onProgress) onProgress(Math.min(0.99, meta.mediaTime / duration));

                // Keep the encoder from falling behind playback. Only one drain
                // runs at a time: stacked drains each called play(), and play() on
                // a clip that has already ended starts it again from the top.
                if (!draining && encoder.encodeQueueSize > 12) {
                    draining = true;
                    source.pause();
                    const drain = setInterval(() => {
                        if (done) { clearInterval(drain); return; }
                        if (encoder.encodeQueueSize <= 4) {
                            clearInterval(drain);
                            draining = false;
                            clock.lastFrameAt = performance.now();
                            source.play().catch(() => {});
                        }
                    }, 50);
                }

                source.requestVideoFrameCallback(onFrame);
            };

            source.onended = () => finish('slut');
            source.requestVideoFrameCallback(onFrame);
            source.play().catch(e => finish('afspilning afvist: ' + e.message));
        });

        document.removeEventListener('visibilitychange', onVisibility);

        if (encoderError) {
            try { encoder.close(); } catch (e) { /* already gone */ }
            cleanUp();
            return fail('encoderfejl: ' + encoderError.message);
        }

        // Most of the clip should have come through. A capture that stalled
        // part way would otherwise produce a short file that looks plausible.
        if (stats.frames < stats.expectedFrames * 0.8) {
            try { encoder.close(); } catch (e) { /* already gone */ }
            cleanUp();
            return fail(`kun ${stats.frames} af ca. ${stats.expectedFrames} billeder blev fanget (${stats.stopReason})`);
        }

        let blob;
        try {
            await encoder.flush();
            encoder.close();
            muxer.finalize();
            blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
        } catch (e) {
            cleanUp();
            return fail('filen kunne ikke færdiggøres: ' + e.message);
        }
        cleanUp();

        if (blob.size >= file.size) {
            return fail(`resultatet (${mb(blob.size)}) var ikke mindre end originalen (${mb(file.size)})`);
        }

        // Last check before trusting it: the result has to be readable, and as
        // long as the original. A file that encoded but plays for two seconds
        // instead of fifteen is worse than no saving at all.
        try {
            const check = await loadVideo(new File([blob], 'check.mp4', { type: 'video/mp4' }));
            const got = check.duration;
            URL.revokeObjectURL(check.src);
            if (!isFinite(got) || Math.abs(got - duration) >= 0.75) {
                return fail(`varigheden passede ikke: ${got}s mod ${duration}s`);
            }
        } catch (e) {
            return fail('resultatet kunne ikke afspilles');
        }

        console.log('Video optimeret', {
            seconds: ((performance.now() - started) / 1000).toFixed(1),
            ...stats,
        });

        return {
            file: new File([blob], rename(file.name, 'mp4'), { type: 'video/mp4' }),
            note: `${mb(file.size)} → ${mb(blob.size)}`,
        };
    }

    // ------------------------------------------------------------------ api

    /**
     * Returns a file ready to upload. Always resolves - on any problem it
     * hands back exactly what it was given.
     *
     * @param {File} file
     * @param {(stage: string, ratio: number|null) => void} [onProgress]
     */
    async function prepare(file, onProgress) {
        if (!file) return { file, note: null };

        try {
            if (/^image\//.test(file.type)) {
                if (onProgress) onProgress('Optimerer billede', null);
                const out = await optimiseImage(file);
                return out || { file, note: null };
            }
            if (/^video\//.test(file.type)) {
                // Frames are captured as the clip plays. Switching tabs is allowed -
                // the capture waits - but staying is the dependable way, so it is
                // suggested rather than required.
                const stage = 'Optimerer video, bliv gerne på fanen';
                if (onProgress) onProgress(stage, 0);
                const out = await optimiseVideo(file, r => onProgress && onProgress(stage, r));
                return out || { file, note: null };
            }
        } catch (e) {
            console.warn('Optimering sprang over:', e);
        }
        return { file, note: null };
    }

    window.MediaOptimiser = { prepare };
})();
