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
        if (!videoSupported()) return null;

        let source;
        try {
            source = await loadVideo(file);
        } catch (e) {
            return null;
        }

        const cleanUp = () => URL.revokeObjectURL(source.src);

        const sw = source.videoWidth;
        const sh = source.videoHeight;
        const duration = source.duration;
        if (!sw || !sh || !isFinite(duration) || duration <= 0) { cleanUp(); return null; }

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
            output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
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
            if (!support || !support.supported) { cleanUp(); return null; }
            encoder.configure(config);
        } catch (e) {
            cleanUp();
            return null;
        }

        // Frames are pulled as they are presented, so the encode runs at
        // playback speed. A short product clip is a few seconds of waiting.
        const frames = await new Promise(resolve => {
            let count = 0;
            let lastTimestamp = -1;

            const onFrame = (now, meta) => {
                if (encoderError) return resolve(count);

                // Microseconds, and strictly increasing or the encoder rejects it
                let timestamp = Math.round(meta.mediaTime * 1e6);
                if (timestamp <= lastTimestamp) timestamp = lastTimestamp + 1;
                lastTimestamp = timestamp;

                let frame;
                try {
                    frame = new window.VideoFrame(source, { timestamp });
                } catch (e) {
                    return resolve(count);
                }

                const isKeyFrame = count % Math.round(FRAMERATE * KEYFRAME_SECONDS) === 0;
                try {
                    encoder.encode(frame, { keyFrame: isKeyFrame });
                } catch (e) {
                    frame.close();
                    return resolve(count);
                }
                frame.close();
                count++;

                if (onProgress) onProgress(Math.min(0.99, meta.mediaTime / duration));

                // Keep the encoder from falling behind playback
                if (encoder.encodeQueueSize > 12) {
                    source.pause();
                    const drain = setInterval(() => {
                        if (encoder.encodeQueueSize <= 4) {
                            clearInterval(drain);
                            source.play().catch(() => {});
                        }
                    }, 50);
                }

                source.requestVideoFrameCallback(onFrame);
            };

            source.onended = () => resolve(count);
            source.requestVideoFrameCallback(onFrame);
            source.play().catch(() => resolve(0));
        });

        // A clip that yielded almost no frames means the capture went wrong
        if (encoderError || frames < 2) {
            try { encoder.close(); } catch (e) { /* already gone */ }
            cleanUp();
            return null;
        }

        let blob;
        try {
            await encoder.flush();
            encoder.close();
            muxer.finalize();
            blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
        } catch (e) {
            cleanUp();
            return null;
        }
        cleanUp();

        if (blob.size >= file.size) return null;

        // Last check before trusting it: the result has to be readable, and as
        // long as the original. A file that encoded but plays for two seconds
        // instead of fifteen is worse than no saving at all.
        try {
            const check = await loadVideo(new File([blob], 'check.mp4', { type: 'video/mp4' }));
            const ok = isFinite(check.duration) && Math.abs(check.duration - duration) < 0.75;
            URL.revokeObjectURL(check.src);
            if (!ok) return null;
        } catch (e) {
            return null;
        }

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
                if (onProgress) onProgress('Optimerer video', 0);
                const out = await optimiseVideo(file, r => onProgress && onProgress('Optimerer video', r));
                return out || { file, note: null };
            }
        } catch (e) {
            console.warn('Optimering sprang over:', e);
        }
        return { file, note: null };
    }

    window.MediaOptimiser = { prepare };
})();
