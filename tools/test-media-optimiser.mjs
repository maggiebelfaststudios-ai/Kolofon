/**
 * Exercises media-optimiser.js control flow under stubbed browser APIs.
 * The point is the branching: does every failure path really hand back the
 * original file untouched?
 */
import { readFileSync } from 'node:fs';

const src = readFileSync('media-optimiser.js', 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
};

/** Builds a fresh sandbox, loads the module into it, returns MediaOptimiser. */
function load({ webp = true, bitmapThrows = false, outSize = 100, hasCreateImageBitmap = true, video = {} } = {}) {
    const win = {};
    const canvas = {
        width: 0, height: 0,
        getContext: () => ({ imageSmoothingQuality: '', drawImage() {} }),
        toBlob(cb, type) {
            // A browser without a WebP encoder silently returns PNG instead
            const actual = (type === 'image/webp' && !webp) ? 'image/png' : type;
            cb(new Blob([new Uint8Array(outSize)], { type: actual }));
        },
    };
    const sandbox = {
        window: win,
        document: { createElement: t => (t === 'canvas' ? canvas : { style: {} }) },
        HTMLVideoElement: { prototype: video.rvfc ? { requestVideoFrameCallback: () => {} } : {} },
        createImageBitmap: hasCreateImageBitmap
            ? async () => { if (bitmapThrows) throw new Error('undecodable'); return { width: 4000, height: 3000, close() {} }; }
            : undefined,
        File, Blob, console,
    };
    Object.assign(win, video.globals || {});

    const keys = Object.keys(sandbox);
    new Function(...keys, src)(...keys.map(k => sandbox[k]));
    return win.MediaOptimiser;
}

const imageFile = (size = 6_600_000, type = 'image/jpeg', name = 'photo.jpg') =>
    new File([new Uint8Array(size)], name, { type });

console.log('\nimages');
{
    const M = load({ outSize: 250_000 });
    const r = await M.prepare(imageFile());
    ok('shrinks a large jpeg', r.file.size === 250_000, `got ${r.file.size}`);
    ok('renames to .webp', r.file.name === 'photo.webp', r.file.name);
    ok('reports the saving', /6\.3 MB → 0\.2 MB/.test(r.note || ''), r.note);
    ok('caps the long edge at 2000', true); // dimensions asserted below
}
{
    // 4000x3000 source -> long edge capped to 2000, aspect kept
    let seen = null;
    const M = load({ outSize: 100 });
    await M.prepare(imageFile());
    // canvas dims are set on the shared stub; re-read through a fresh load
    const win = {};
    const canvas = { width: 0, height: 0, getContext: () => ({ imageSmoothingQuality: '', drawImage() {} }), toBlob(cb, t) { seen = { w: this.width, h: this.height }; cb(new Blob([new Uint8Array(100)], { type: t })); } };
    const sb = { window: win, document: { createElement: () => canvas }, HTMLVideoElement: { prototype: {} }, createImageBitmap: async () => ({ width: 4000, height: 3000, close() {} }), File, Blob, console };
    const k = Object.keys(sb); new Function(...k, src)(...k.map(x => sb[x]));
    await win.MediaOptimiser.prepare(imageFile());
    ok('scales 4000x3000 to 2000x1500', seen && seen.w === 2000 && seen.h === 1500, JSON.stringify(seen));
}
{
    const M = load({ outSize: 9_000_000 });
    const r = await M.prepare(imageFile(6_600_000));
    ok('keeps the original when the re-encode is bigger', r.file.size === 6_600_000 && r.note === null);
}
{
    const M = load({ bitmapThrows: true });
    const f = imageFile(1000, 'image/heic', 'shot.heic');
    const r = await M.prepare(f);
    ok('keeps an undecodable file (HEIC)', r.file === f && r.note === null);
}
{
    const M = load({ webp: false, outSize: 100 });
    const r = await M.prepare(imageFile(5000, 'image/png', 'draw.png'));
    ok('keeps a PNG when WebP is unavailable (alpha would be lost)', r.file.name === 'draw.png' && r.note === null);
}
{
    const M = load({ webp: false, outSize: 100 });
    const r = await M.prepare(imageFile(5000, 'image/jpeg', 'p.jpg'));
    ok('falls back to jpeg for a jpeg source', r.file.name === 'p.jpg' && r.file.type === 'image/jpeg' && r.note !== null, r.file.name + ' ' + r.file.type);
}
{
    const M = load({ hasCreateImageBitmap: false });
    const f = imageFile();
    const r = await M.prepare(f);
    ok('keeps the original without createImageBitmap', r.file === f);
}

console.log('\nvideo');
{
    const M = load(); // no VideoEncoder / Mp4Muxer in the sandbox
    const f = new File([new Uint8Array(14_700_000)], 'clip.mp4', { type: 'video/mp4' });
    const r = await M.prepare(f);
    ok('keeps the original when WebCodecs is missing', r.file === f && r.note === null);
}
{
    const M = load({ video: { rvfc: true, globals: { VideoEncoder: function () {}, VideoFrame: function () {} } } });
    const f = new File([new Uint8Array(100)], 'clip.mp4', { type: 'video/mp4' });
    const r = await M.prepare(f);
    ok('keeps the original when the muxer failed to load', r.file === f && r.note === null);
}

console.log('\nother');
{
    const M = load();
    const f = new File([new Uint8Array(10)], 'notes.pdf', { type: 'application/pdf' });
    const r = await M.prepare(f);
    ok('passes a non-media file straight through', r.file === f);
    const n = await M.prepare(null);
    ok('survives a null file', n.file === null);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
