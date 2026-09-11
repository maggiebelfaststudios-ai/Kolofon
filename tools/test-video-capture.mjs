/**
 * Simulates the browser video capture in media-optimiser.js.
 *
 * The fallback tests never exercised the capture loop, and that loop is where
 * the first real upload went wrong: it ran for minutes and then quietly handed
 * back the original. These fakes behave like the real APIs in the ways that
 * matter - frames arrive while playing, an encoder can fall behind, and play()
 * on a clip that has ended starts it again from the top.
 *
 * Usage: node tools/test-video-capture.mjs [path-to-media-optimiser.js]
 */
import { readFileSync } from 'node:fs';

const path = process.argv[2] || 'media-optimiser.js';
const src = readFileSync(path, 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
};

function load({ duration = 1, fps = 30, presentFrames = true, slowEncoder = false, clockSpeed = 1 } = {}) {
    const video = { plays: 0, playAfterEnded: 0 };
    const enc = { encodes: 0, encodeAfterClose: 0 };
    const warnings = [];

    class FakeVideo {
        constructor() {
            this.videoWidth = 1080; this.videoHeight = 1920; this.duration = duration;
            this.currentTime = 0; this.paused = true; this.ended = false;
            this._cbs = []; this._timer = null;
        }
        set src(v) { this._src = v; setTimeout(() => this.onloadedmetadata && this.onloadedmetadata(), 0); }
        get src() { return this._src; }
        requestVideoFrameCallback(cb) { this._cbs.push(cb); }
        play() {
            video.plays++;
            if (this.ended) { video.playAfterEnded++; this.ended = false; this.currentTime = 0; }
            this.paused = false;
            if (!presentFrames) return Promise.resolve();
            clearInterval(this._timer);
            this._timer = setInterval(() => {
                if (this.paused) return;
                this.currentTime += 1 / fps;
                if (this.currentTime >= this.duration) {
                    clearInterval(this._timer);
                    this.paused = true; this.ended = true;
                    if (this.onended) this.onended();
                    return;
                }
                const cbs = this._cbs; this._cbs = [];
                cbs.forEach(cb => cb(0, { mediaTime: this.currentTime }));
            }, 2);
            return Promise.resolve();
        }
        pause() { this.paused = true; }
    }

    class FakeEncoder {
        static async isConfigSupported(config) { return { supported: true, config }; }
        constructor({ output }) { this.output = output; this.encodeQueueSize = 0; this.closed = false; this.first = true; }
        configure() {}
        encode(frame, opts) {
            if (this.closed) { enc.encodeAfterClose++; throw new Error('encoder is closed'); }
            enc.encodes++;
            this.encodeQueueSize++;
            setTimeout(() => {
                this.encodeQueueSize--;
                if (this.closed) return;
                const meta = this.first ? { decoderConfig: {} } : undefined;
                this.first = false;
                this.output({ type: opts && opts.keyFrame ? 'key' : 'delta' }, meta);
            }, slowEncoder ? 40 : 1);
        }
        async flush() { while (this.encodeQueueSize > 0) await new Promise(r => setTimeout(r, 5)); }
        close() { this.closed = true; }
    }

    const Mp4Muxer = {
        ArrayBufferTarget: class { constructor() { this.buffer = null; } },
        Muxer: class {
            constructor({ target }) { this.target = target; this.chunks = 0; }
            addVideoChunk() { this.chunks++; }
            finalize() { this.target.buffer = new ArrayBuffer(50 * this.chunks); }
        },
    };

    const win = {
        VideoEncoder: FakeEncoder,
        VideoFrame: class { close() {} },
        Mp4Muxer,
    };
    const origin = performance.now();
    const sandbox = {
        window: win,
        document: {
            hidden: false,
            createElement: t => (t === 'video' ? new FakeVideo() : {}),
            addEventListener() {}, removeEventListener() {},
        },
        HTMLVideoElement: { prototype: { requestVideoFrameCallback() {} } },
        createImageBitmap: undefined,
        File, Blob,
        URL: { createObjectURL: () => 'blob:fake', revokeObjectURL() {} },
        // A faster clock lets the 15 second watchdog be tested in about one second
        performance: { now: () => origin + (performance.now() - origin) * clockSpeed },
        console: { log() {}, warn: (...a) => warnings.push(a.map(String).join(' ')) },
    };
    const keys = Object.keys(sandbox);
    new Function(...keys, src)(...keys.map(k => sandbox[k]));
    return { M: win.MediaOptimiser, video, enc, warnings };
}

const clip = () => new File([new Uint8Array(10_000_000)], 'clip.mp4', { type: 'video/mp4' });

/** Resolves with the result, or 'TIMEOUT' if the capture never finishes. */
const within = (promise, ms) => Promise.race([
    promise,
    new Promise(r => setTimeout(() => r('TIMEOUT'), ms)),
]);

console.log('\ncapture - normal run');
{
    const t = load();
    const r = await within(t.M.prepare(clip()), 5000);
    ok('finishes', r !== 'TIMEOUT');
    ok('produces an optimised file', r !== 'TIMEOUT' && r.note !== null, r === 'TIMEOUT' ? 'timed out' : String(r.note));
    await new Promise(r => setTimeout(r, 200)); // let any stray timers fire
    ok('nothing is encoded after the encoder closes', t.enc.encodeAfterClose === 0, `${t.enc.encodeAfterClose} stray encodes`);
    ok('the finished clip is never restarted', t.video.playAfterEnded === 0, `restarted ${t.video.playAfterEnded} times`);
}

console.log('\ncapture - encoder falls behind');
{
    const t = load({ slowEncoder: true });
    const r = await within(t.M.prepare(clip()), 8000);
    ok('still finishes', r !== 'TIMEOUT');
    await new Promise(r => setTimeout(r, 500));
    ok('the finished clip is never restarted', t.video.playAfterEnded === 0, `restarted ${t.video.playAfterEnded} times`);
    ok('nothing is encoded after the encoder closes', t.enc.encodeAfterClose === 0, `${t.enc.encodeAfterClose} stray encodes`);
}

console.log('\ncapture - stalls (as in a hidden tab)');
{
    const t = load({ presentFrames: false, clockSpeed: 40 });
    const r = await within(t.M.prepare(clip()), 6000);
    ok('gives up instead of hanging', r !== 'TIMEOUT');
    ok('hands back the original', r !== 'TIMEOUT' && r.note === null);
    ok('says why in the console', t.warnings.some(w => /ingen nye billeder/.test(w)), t.warnings.join(' | ') || 'no warning');
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
