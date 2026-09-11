/**
 * Simulates the browser video capture in media-optimiser.js.
 *
 * The fallback tests never exercised the capture loop, and that loop is where
 * the first real upload went wrong: it ran for minutes and then quietly handed
 * back the original. These fakes behave like the real APIs in the ways that
 * matter - frames arrive while playing, an encoder can fall behind, and play()
 * on a clip that has ended starts it again from the top.
 *
 * The muxer is the real one, fetched from the same URL the admin page loads.
 * An earlier fake accepted any chunk it was given, and so passed a version
 * whose every chunk the real muxer rejected - which is exactly how the first
 * live upload failed. Needs a network connection for that reason.
 *
 * Usage: node tools/test-video-capture.mjs [path-to-media-optimiser.js]
 */
import { readFileSync } from 'node:fs';

const path = process.argv[2] || 'media-optimiser.js';
const src = readFileSync(path, 'utf8');

const muxerUrl = (readFileSync('admin.html', 'utf8').match(/https:\/\/cdn\.jsdelivr\.net\/npm\/mp4-muxer@[^"]+/) || [])[0];
if (!muxerUrl) { console.error('Could not find the mp4-muxer URL in admin.html'); process.exit(2); }
let muxerSource;
try {
    muxerSource = await (await fetch(muxerUrl)).text();
} catch (e) {
    console.error('Could not fetch the real muxer (' + muxerUrl + '): ' + e.message);
    process.exit(2);
}
// The muxer checks instanceof EncodedVideoChunk, a browser class Node does not
// have. This stands in for it with the fields a real chunk exposes - including
// a duration that is null when the frame it came from had none.
class EncodedVideoChunk {
    constructor({ type, timestamp, duration = null, data }) {
        this.type = type;
        this.timestamp = timestamp;
        this.duration = duration;
        this.byteLength = data.byteLength;
        this._data = data;
    }
    copyTo(dest) { dest.set(this._data); }
}
class EncodedAudioChunk {}

const RealMp4Muxer = new Function('EncodedVideoChunk', 'EncodedAudioChunk', muxerSource + '\n;return Mp4Muxer;')(EncodedVideoChunk, EncodedAudioChunk);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
};

function load({ duration = 1, fps = 30, presentFrames = true, slowEncoder = false, clockSpeed = 1 } = {}) {
    const video = { plays: 0, playAfterEnded: 0 };
    const enc = { encodes: 0, encodeAfterClose: 0 };
    const warnings = [];

    // Visibility the test can flip mid-capture, with listeners that really fire
    const doc = {
        hidden: false,
        listeners: [],
        setHidden(h) { this.hidden = h; this.listeners.forEach(fn => fn()); },
    };

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
                if (this.paused || doc.hidden) return; // a background tab suspends playback
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
                // As a real encoder does, the chunk takes its timestamp and duration
                // from the frame - so a frame with no duration gives a chunk with none.
                const chunk = new EncodedVideoChunk({
                    type: opts && opts.keyFrame ? 'key' : 'delta',
                    timestamp: frame.timestamp,
                    duration: frame.duration,
                    data: new Uint8Array(100),
                });
                const meta = this.first
                    ? { decoderConfig: { codec: 'avc1.640028', codedWidth: 1080, codedHeight: 1920, description: new Uint8Array([1, 100, 0, 40, 255, 225]).buffer } }
                    : undefined;
                this.first = false;
                this.output(chunk, meta);
            }, slowEncoder ? 40 : 1);
        }
        async flush() { while (this.encodeQueueSize > 0) await new Promise(r => setTimeout(r, 5)); }
        close() { this.closed = true; }
    }

    const Mp4Muxer = RealMp4Muxer;

    const win = {
        VideoEncoder: FakeEncoder,
        VideoFrame: class { constructor(source, init = {}) { this.timestamp = init.timestamp; this.duration = init.duration ?? null; } close() {} },
        Mp4Muxer,
    };
    const origin = performance.now();
    const sandbox = {
        window: win,
        document: {
            get hidden() { return doc.hidden; },
            createElement: t => (t === 'video' ? new FakeVideo() : {}),
            addEventListener: (type, fn) => { if (type === 'visibilitychange') doc.listeners.push(fn); },
            removeEventListener: (type, fn) => { doc.listeners = doc.listeners.filter(x => x !== fn); },
        },
        HTMLVideoElement: { prototype: { requestVideoFrameCallback() {} } },
        createImageBitmap: undefined,
        File, Blob,
        URL: { createObjectURL: () => 'blob:fake', revokeObjectURL() {} },
        // A faster clock lets the 60 second watchdog be tested in about one second
        performance: { now: () => origin + (performance.now() - origin) * clockSpeed },
        console: { log() {}, warn: (...a) => warnings.push(a.map(String).join(' ')) },
    };
    const keys = Object.keys(sandbox);
    new Function(...keys, src)(...keys.map(k => sandbox[k]));
    return { M: win.MediaOptimiser, video, enc, warnings, doc };
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

console.log('\ncapture - frozen with the tab in front');
{
    // 60 simulated seconds pass in well under two real ones
    const t = load({ presentFrames: false, clockSpeed: 100 });
    const r = await within(t.M.prepare(clip()), 6000);
    ok('gives up instead of hanging', r !== 'TIMEOUT');
    ok('hands back the original', r !== 'TIMEOUT' && r.note === null);
    ok('says why in the console', t.warnings.some(w => /ingen nye billeder/.test(w)), t.warnings.join(' | ') || 'no warning');
}

console.log('\ncapture - tab hidden for a long time, then brought back');
{
    // Hidden for 3 real seconds at 100x is 5 simulated minutes - far past the
    // 60 second stall limit, which is exactly what must not count against it.
    const t = load({ clockSpeed: 100 });
    const run = t.M.prepare(clip());
    await new Promise(r => setTimeout(r, 20));
    t.doc.setHidden(true);
    await new Promise(r => setTimeout(r, 3000));
    t.doc.setHidden(false);
    const r = await within(run, 8000);
    ok('does not give up while the tab is away', !t.warnings.some(w => /ingen nye billeder/.test(w)), t.warnings.join(' | '));
    ok('finishes once the tab is back', r !== 'TIMEOUT' && r.note !== null, r === 'TIMEOUT' ? 'timed out' : 'fell back: ' + t.warnings.join(' | '));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
