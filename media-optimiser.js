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
    // Higher than a High profile encode would need: Baseline (see below) has no
    // CABAC or 8x8 transform, and fine repeating detail - the grids in these
    // pieces - is where that shows first. Still around a sixth of a phone clip.
    const VIDEO_BITRATE = 3_500_000;

    // Constrained Baseline, tried from the lowest level that fits 1080x1920 up.
    // Baseline cannot contain B-frames. High profile can, and a hardware encoder
    // using them returns frames in decoding order rather than display order -
    // 0, 2, 1 - which the muxer rejects because timestamps must keep rising.
    // That is what failed on a real upload. Baseline is also the one H.264
    // variant every device can play.
    const CODECS = ['avc1.42E028', 'avc1.42E02A', 'avc1.42E032', 'avc1.42E033'];
    const KEYFRAME_SECONDS = 2;
    const FRAMERATE = 30;
    const FRAME_DURATION_US = Math.round(1e6 / FRAMERATE);

    // How long a visible tab may go without any progress before the capture is
    // abandoned. Slow is fine - this only catches a frozen one, and time spent
    // in a background tab is not counted at all.
    const STALL_SECONDS = 60;

    // Frames handed to the encoder but not yet taken up. Each is a whole decoded
    // picture - several megabytes at 1080x1920 - so the backlog is kept short.
    const MAX_ENCODE_QUEUE = 8;

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

    // requestVideoFrameCallback is no longer needed: frames are reached by
    // seeking rather than caught while playing (see optimiseVideo).
    function videoSupported() {
        return typeof window.VideoEncoder === 'function'
            && typeof window.VideoFrame === 'function'
            && typeof window.Mp4Muxer === 'object';
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
        // clipSecondsReached against frames shows whether frames were dropped or the
        // capture simply ran slowly - a gap between the two means dropped frames.
        const stats = { frames: 0, expectedFrames: null, clipSecondsReached: 0, tabWasHidden: false, stopReason: null, codec: null };

        // Every way out of here says which check tripped, in the console.
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

        const total = Math.max(1, Math.floor(duration * FRAMERATE));
        stats.expectedFrames = total;

        // Cap the long edge at 1920 and the short at 1080, keeping the shape.
        const longEdge = Math.max(sw, sh);
        const shortEdge = Math.min(sw, sh);
        const scale = Math.min(1, MAX_VIDEO_LONG / longEdge, MAX_VIDEO_SHORT / shortEdge);
        // H.264 wants even dimensions
        const width = Math.round(sw * scale / 2) * 2;
        const height = Math.round(sh * scale / 2) * 2;

        // When anything last moved forward - a frame handed over, or one coming back
        // from the encoder. Shared with the encoder callback and the visibility
        // listener, so it is set up before either.
        const clock = { lastProgressAt: performance.now(), hiddenSince: null };

        const muxer = new window.Mp4Muxer.Muxer({
            target: new window.Mp4Muxer.ArrayBufferTarget(),
            // No frameRate here. Passing one makes it the timescale and snaps every
            // timestamp to that grid, which the muxer only supports for frames that
            // land exactly on it; sources are often 29.97 fps rather than 30.
            video: { codec: 'avc', width, height },
            // The same faststart the desktop tool applies: the index goes at the
            // front so playback can begin before the download finishes.
            fastStart: 'in-memory',
            firstTimestampBehavior: 'offset',
        });

        let encoderError = null;
        const encoder = new window.VideoEncoder({
            output: (chunk, meta) => {
                clock.lastProgressAt = performance.now();
                try {
                    muxer.addVideoChunk(chunk, meta);
                } catch (e) {
                    encoderError = e;
                }
            },
            error: e => { encoderError = e; },
        });

        // Not every build ships an H.264 encoder, or supports every level, so
        // ask about each in turn rather than assume.
        let config = null;
        try {
            for (const codec of CODECS) {
                const candidate = { codec, width, height, bitrate: VIDEO_BITRATE, framerate: FRAMERATE };
                const support = await window.VideoEncoder.isConfigSupported(candidate);
                if (support && support.supported) { config = candidate; break; }
            }
            if (!config) {
                cleanUp();
                return fail('browseren har ingen Baseline H.264-encoder til denne opløsning');
            }
            stats.codec = config.codec;
            encoder.configure(config);
        } catch (e) {
            cleanUp();
            return fail('encoderen kunne ikke konfigureres: ' + e.message);
        }

        // Time spent in a background tab is not held against the capture: whatever
        // passes there is added back when the tab returns. The event is used rather
        // than polling because browsers throttle timers in background tabs, and a
        // poll would miss how long the tab was actually away.
        const onVisibility = () => {
            if (document.hidden) {
                stats.tabWasHidden = true;
                clock.hiddenSince = performance.now();
            } else if (clock.hiddenSince !== null) {
                clock.lastProgressAt += performance.now() - clock.hiddenSince;
                clock.hiddenSince = null;
            }
        };
        if (document.hidden) clock.hiddenSince = performance.now();
        document.addEventListener('visibilitychange', onVisibility);

        // Step through the clip by seeking to each frame, rather than playing it and
        // catching frames as the browser paints them. Playing lost 54 of 232 frames
        // on a real upload: under the load of encoding the browser skips painting
        // some frames, and a frame never painted is never reported. A seek lands on
        // whatever timestamp is asked for, so none can be missed, and nothing has to
        // be paused while the encoder catches up.
        let stalled = null;
        let cancelSeek = null;

        const watchdog = setInterval(() => {
            if (document.hidden) return;
            if (performance.now() - clock.lastProgressAt > STALL_SECONDS * 1000) {
                stalled = `ingen fremgang i ${STALL_SECONDS} sekunder med fanen åben`;
                if (cancelSeek) cancelSeek(new Error(stalled));
            }
        }, 1000);

        const seekTo = time => new Promise((resolve, reject) => {
            const finish = err => {
                source.removeEventListener('seeked', onSeeked);
                source.removeEventListener('error', onError);
                cancelSeek = null;
                if (err) reject(err); else resolve();
            };
            const onSeeked = () => finish();
            const onError = () => finish(new Error('videoen kunne ikke spoles'));
            source.addEventListener('seeked', onSeeked);
            source.addEventListener('error', onError);
            cancelSeek = finish;
            source.currentTime = time;
        });

        const keyInterval = Math.round(FRAMERATE * KEYFRAME_SECONDS);
        let count = 0;

        try {
            for (let i = 0; i < total; i++) {
                if (encoderError) { stats.stopReason = 'encoderfejl: ' + encoderError.message; break; }
                if (stalled) { stats.stopReason = stalled; break; }

                // Frames are only taken while the tab is visible. A hidden page may
                // not refresh the picture a seek lands on, and capturing then could
                // record the same image over and over with nothing to flag it. So
                // leaving the tab simply pauses the job until it comes back.
                while (document.hidden && !stalled && !encoderError) {
                    await new Promise(r => setTimeout(r, 250));
                }

                try {
                    // Half a frame in, so a seek never lands on the boundary between
                    // two pictures and picks up the neighbouring one.
                    await seekTo((i + 0.5) / FRAMERATE);
                    // A seek can report done a moment before its picture is decoded
                    for (let n = 0; source.readyState < 2 && n < 100; n++) {
                        await new Promise(r => setTimeout(r, 20));
                    }
                } catch (e) {
                    stats.stopReason = e.message;
                    break;
                }

                // Hidden while that seek was under way: its picture cannot be
                // trusted, so wait for the tab and take this frame again.
                if (document.hidden) { i--; continue; }

                let frame;
                try {
                    // The duration is not optional in practice: an encoded chunk
                    // inherits it, and the muxer rejects any chunk without one. Only
                    // the last frame's length comes from it - the muxer uses the real
                    // gap between timestamps for the rest.
                    frame = new window.VideoFrame(source, {
                        timestamp: Math.round(i * 1e6 / FRAMERATE),
                        duration: FRAME_DURATION_US,
                    });
                } catch (e) {
                    stats.stopReason = 'billede kunne ikke læses: ' + e.message;
                    break;
                }

                try {
                    encoder.encode(frame, { keyFrame: i % keyInterval === 0 });
                } catch (e) {
                    stats.stopReason = 'encode fejlede: ' + e.message;
                    break;
                } finally {
                    frame.close();
                }

                count++;
                clock.lastProgressAt = performance.now();
                stats.clipSecondsReached = Number(((i + 1) / FRAMERATE).toFixed(2));
                if (onProgress) onProgress(Math.min(0.99, (i + 1) / total));

                while (encoder.encodeQueueSize > MAX_ENCODE_QUEUE && !encoderError && !stalled) {
                    await new Promise(r => setTimeout(r, 20));
                }
            }
            if (!stats.stopReason) stats.stopReason = 'slut';
        } finally {
            clearInterval(watchdog);
            document.removeEventListener('visibilitychange', onVisibility);
        }
        stats.frames = count;

        if (encoderError) {
            try { encoder.close(); } catch (e) { /* already gone */ }
            cleanUp();
            return fail('encoderfejl: ' + encoderError.message);
        }

        // Every frame is reached deliberately now, so anything short of all of them
        // means the capture was cut off - not a clip worth keeping.
        if (count < total) {
            try { encoder.close(); } catch (e) { /* already gone */ }
            cleanUp();
            return fail(`kun ${count} af ${total} billeder blev fanget (${stats.stopReason})`);
        }

        let blob;
        try {
            await encoder.flush();
            encoder.close();
            if (encoderError) throw encoderError;
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
                // Leaving the tab pauses the job rather than breaking it, so say that
                // plainly instead of asking the uploader to stay put.
                const stage = 'Optimerer video (holder pause hvis du forlader fanen)';
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
