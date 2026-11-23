#!/usr/bin/env node
// Builds Y4M clips for Chrome's fake camera from a still frame and from
// recordings. Output: eval/.cache/clips/<source>/<condition>.y4m
//
//   node eval/fixtures/build.mjs --source standin
//   node eval/fixtures/build.mjs --source recordings
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONDITIONS, FRAME, RECORDED } from '../harness/conditions.mjs';

const EVAL = join(dirname(fileURLToPath(import.meta.url)), '..');
const RECORDINGS = join(EVAL, 'fixtures', 'recordings');

// Public-domain White House portrait from the MediaPipe sample assets. Used
// only until recordings exist; downloaded at build time, never committed.
const STANDIN = {
  url: 'https://storage.googleapis.com/mediapipe-assets/portrait.jpg',
  sha256: 'a6f11efaa834706db23f275b6115058fa87fc7f14362681e6abe14e82749de3e',
  center: [403, 200],
  window: [720, 405],
};

// Temporal noise so a still frame exercises the tracker like a live sensor.
const NOISE = 'noise=alls=5:allf=t';
const PAD = 1200;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

const ffmpeg = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

const fetchStandin = (dir) => {
  const file = join(dir, 'portrait.jpg');
  if (!existsSync(file)) execFileSync('curl', ['-sSfL', '-o', file, STANDIN.url]);
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (digest !== STANDIN.sha256) throw new Error(`stand-in hash mismatch: ${digest}`);
  return file;
};

const firstFrame = (video, dir) => {
  const file = join(dir, 'first-frame.png');
  ffmpeg(['-i', video, '-frames:v', '1', file]);
  return file;
};

// Crop a window around the face from a padded still, rotate about the window
// centre, scale to the output frame. Moving the window by -dx/k moves the face
// by +dx output pixels, where k is the output/source scale.
const sweepFilter = ({ center, window }, { roll, dx, dy, zoom }) => {
  const w = Math.round(window[0] / zoom);
  const h = Math.round(window[1] / zoom);
  const k = FRAME.width / w;
  const x = Math.round(PAD + center[0] - w / 2 - dx / k);
  const y = Math.round(PAD + center[1] - h / 2 - dy / k);
  return [
    `pad=iw+${2 * PAD}:ih+${2 * PAD}:${PAD}:${PAD}:color=0x808080`,
    `crop=${w}:${h}:${x}:${y}`,
    `rotate=${(roll * Math.PI) / 180}:c=0x808080`,
    `scale=${FRAME.width}:${FRAME.height}:flags=bicubic`,
    NOISE,
    'format=yuv420p',
  ].join(',');
};

const buildSweeps = (still, framing, outDir) => {
  for (const condition of CONDITIONS) {
    const out = join(outDir, `${condition.id}.y4m`);
    ffmpeg([
      '-loop', '1', '-framerate', String(FRAME.fps), '-t', String(condition.clipSeconds), '-i', still,
      '-vf', sweepFilter(framing, condition), '-r', String(FRAME.fps), out,
    ]);
    console.log(`built ${out}`);
  }
};

const buildRecorded = (outDir) => {
  for (const clip of RECORDED) {
    const src = join(RECORDINGS, clip.file);
    if (!existsSync(src)) {
      console.log(`skipped ${clip.id}: ${src} not found`);
      continue;
    }
    const out = join(outDir, `${clip.id}.y4m`);
    ffmpeg(['-i', src, '-vf', `scale=${FRAME.width}:${FRAME.height},format=yuv420p`, '-r', String(FRAME.fps), out]);
    console.log(`built ${out}`);
  }
};

const source = arg('source', 'standin');
const outDir = join(EVAL, '.cache', 'clips', source);
mkdirSync(outDir, { recursive: true });

if (source === 'standin') {
  buildSweeps(fetchStandin(outDir), STANDIN, outDir);
} else if (source === 'recordings') {
  const still = firstFrame(join(RECORDINGS, 'static.mp4'), outDir);
  buildSweeps(still, { center: [FRAME.width / 2, FRAME.height / 2], window: [FRAME.width, FRAME.height] }, outDir);
  buildRecorded(outDir);
} else {
  throw new Error(`unknown source ${source}; use standin or recordings`);
}
