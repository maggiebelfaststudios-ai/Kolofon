#!/usr/bin/env node
/**
 * Re-encodes a video for delivery over the web.
 *
 * Phones record at roughly 20 Mbps, which is a sensible archival bitrate and a
 * terrible one to serve: it is five or six times what the same picture needs
 * once it is being watched in a browser. This does not touch the resolution -
 * a 1080x1920 clip stays 1080x1920 - it just stops spending twenty megabits a
 * second on it.
 *
 * Two things beyond the bitrate matter here:
 *
 *   faststart  moves the file's index to the front. Without it a browser has
 *              to fetch a large part of the file before it can show a single
 *              frame, which is why a phone-exported clip is slow to start
 *              even on a fast connection.
 *   no audio   the clips on this site are all played muted, so the audio
 *              track is bytes nobody will ever hear. Pass --keep-audio if a
 *              particular clip is meant to be listened to.
 *
 * Usage:
 *   node tools/optimise-video.mjs <file...> [--keep-audio] [--crf N] [--force]
 */

import { spawnSync } from 'node:child_process';
import { statSync, renameSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, extname } from 'node:path';

const TAG = 'kolofon-optimised';       // stamped in, so we never re-encode our own output
const DEFAULT_CRF = 23;                 // visually near-transparent for this kind of footage
const ORIGINALS = '_originals';         // masters are kept, never overwritten

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const crfArg = args.findIndex(a => a === '--crf');
const crf = crfArg !== -1 ? Number(args[crfArg + 1]) : DEFAULT_CRF;
const files = args.filter((a, i) =>
    !a.startsWith('--') && !(crfArg !== -1 && i === crfArg + 1));

const keepAudio = flags.has('--keep-audio');
const force = flags.has('--force');

if (!files.length) {
    console.error('Usage: node tools/optimise-video.mjs <file...> [--keep-audio] [--crf N] [--force]');
    process.exit(1);
}

const run = (cmd, cmdArgs) => spawnSync(cmd, cmdArgs, { encoding: 'utf8' });

// ffprobe ships with ffmpeg, so one check covers both
if (run('ffprobe', ['-version']).error) {
    console.error('\nffmpeg is not installed, so there is nothing to encode with.');
    console.error('Install it once with:\n');
    console.error('    winget install --id Gyan.FFmpeg -e\n');
    console.error('then open a new terminal so it is on your PATH.\n');
    process.exit(2);
}

const mb = b => (b / 1048576).toFixed(1) + ' MB';

/** Reads the bits we need to decide what to do with a file. */
function probe(file) {
    const r = run('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration,size,bit_rate:format_tags=comment:stream=width,height',
        '-select_streams', 'v:0',
        '-of', 'json',
        file,
    ]);
    if (r.status !== 0) return null;
    const j = JSON.parse(r.stdout);
    const s = j.streams?.[0] ?? {};
    return {
        width: s.width,
        height: s.height,
        duration: Number(j.format?.duration ?? 0),
        size: Number(j.format?.size ?? 0),
        bitrate: Number(j.format?.bit_rate ?? 0),
        tag: j.format?.tags?.comment ?? '',
    };
}

let totalBefore = 0;
let totalAfter = 0;
let done = 0;

for (const file of files) {
    if (!existsSync(file)) {
        console.error(`  ${basename(file)}: not found, skipping`);
        continue;
    }

    const info = probe(file);
    if (!info) {
        console.error(`  ${basename(file)}: could not be read as video, skipping`);
        continue;
    }

    if (info.tag === TAG && !force) {
        console.log(`  ${basename(file)}: already optimised, leaving alone`);
        continue;
    }

    // Cap the long edge at 1920 and the short at 1080. Anything already within
    // that is left at its own size - this is about bitrate, not resolution.
    const scale = "scale=w='if(gt(a,1),min(1920,iw),min(1080,iw))':h=-2";

    const tmp = join(dirname(file), '.optimising-' + basename(file));
    const encodeArgs = [
        '-y', '-i', file,
        '-vf', scale,
        '-c:v', 'libx264',
        '-preset', 'slow',        // one-time cost, meaningfully smaller file
        '-crf', String(crf),
        '-profile:v', 'high',
        '-pix_fmt', 'yuv420p',    // Safari refuses to play anything else
        '-movflags', '+faststart',
        ...(keepAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']),
        '-metadata', `comment=${TAG}`,
        tmp,
    ];

    const dims = `${info.width}x${info.height}`;
    const rate = (info.bitrate / 1e6).toFixed(1);
    process.stdout.write(`  ${basename(file)}: ${dims}, ${mb(info.size)} at ${rate} Mbps -> encoding... `);

    const enc = spawnSync('ffmpeg', encodeArgs, { encoding: 'utf8' });
    if (enc.status !== 0) {
        console.log('failed');
        console.error(enc.stderr?.split('\n').slice(-12).join('\n'));
        if (existsSync(tmp)) unlinkSync(tmp);
        process.exitCode = 1;
        continue;
    }

    const after = statSync(tmp).size;

    // Encoding a clip that was already lean can come out bigger. Keep whichever
    // is smaller rather than blindly taking the new one.
    if (after >= info.size) {
        console.log(`no saving (${mb(after)}), keeping the original`);
        unlinkSync(tmp);
        continue;
    }

    // The master is kept out of the way rather than overwritten, so a bad
    // encode is never the end of the only copy.
    const keepDir = join(dirname(file), ORIGINALS);
    mkdirSync(keepDir, { recursive: true });
    renameSync(file, join(keepDir, basename(file)));
    renameSync(tmp, file);

    const saved = (100 - (after / info.size) * 100).toFixed(0);
    console.log(`${mb(after)}, ${saved}% smaller`);
    totalBefore += info.size;
    totalAfter += after;
    done++;
}

if (done) {
    const saved = (100 - (totalAfter / totalBefore) * 100).toFixed(0);
    console.log(`\n  ${done} file(s): ${mb(totalBefore)} -> ${mb(totalAfter)}, ${saved}% smaller`);
    console.log(`  Originals kept in ${ORIGINALS}/ (not committed).`);
}
