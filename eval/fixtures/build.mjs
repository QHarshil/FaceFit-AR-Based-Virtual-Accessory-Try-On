#!/usr/bin/env node
// Builds Y4M clips for Chrome's fake camera from a still frame and from
// recordings. Output: eval/.cache/clips/<source>/<condition>.y4m
//
//   node eval/fixtures/build.mjs --source standin                 (adds the two-face clip)
//   node eval/fixtures/build.mjs --source standin --only two-face
//   node eval/fixtures/build.mjs --source recordings              (adds the motion clips)
//   node eval/fixtures/build.mjs --source recordings --only motion --recordings <dir>
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONDITIONS, FRAME, FRAME_CODE, MOTION, RECORDED, TWO_FACE, motionExpression } from '../harness/conditions.mjs';

const EVAL = join(dirname(fileURLToPath(import.meta.url)), '..');

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

// Recordings from another checkout can be read in place with --recordings.
const RECORDINGS = arg('recordings') ? resolve(arg('recordings')) : join(EVAL, 'fixtures', 'recordings');
const only = arg('only', 'all');
if (!['all', 'motion', 'two-face'].includes(only)) throw new Error(`unknown --only ${only}; use motion or two-face`);

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

// Draws the clip frame index N as FRAME_CODE.bits black or white squares
// along the top edge, least significant bit first, with neutral chroma so the
// page reads it back from any colour channel.
const frameCodeFilter = () => {
  const { bits, blockPx: b } = FRAME_CODE;
  const inCode = (scale) => `lt(Y,${b / scale})*lt(X,${(bits * b) / scale})`;
  return [
    `geq=lum='if(${inCode(1)},if(bitand(N,pow(2,floor(X/${b}))),235,16),lum(X,Y))'`,
    `cb='if(${inCode(2)},128,cb(X,Y))'`,
    `cr='if(${inCode(2)},128,cr(X,Y))'`,
  ].join(':');
};

// Moves the face by motionTruth in each frame. One source pixel is one output
// pixel here. The crop runs on RGB, so an odd shift moves the face by exactly
// that many pixels; on yuv420p it would round to an even one.
const motionFilter = ({ motion }) => {
  const shift = motion.axis === 'dx' ? motionExpression(motion) : '0';
  const roll = motion.axis === 'roll' ? motionExpression(motion) : '0';
  return [
    'format=rgb24',
    `pad=iw+${2 * PAD}:ih+${2 * PAD}:${PAD}:${PAD}:color=0x808080`,
    `crop=${FRAME.width}:${FRAME.height}:'${PAD}-(${shift})':${PAD}`,
    `rotate='(${roll})*PI/180':c=0x808080`,
    NOISE,
    'format=yuv420p',
    frameCodeFilter(),
  ].join(',');
};

const buildMotion = (still, outDir) => {
  for (const condition of MOTION) {
    const out = join(outDir, `${condition.id}.y4m`);
    ffmpeg([
      '-loop', '1', '-framerate', String(FRAME.fps), '-t', String(condition.clipSeconds), '-i', still,
      '-vf', motionFilter(condition), '-r', String(FRAME.fps), out,
    ]);
    console.log(`built ${out}`);
  }
};

// The portrait scaled so the face is `scale` times its size in the
// stand-in's still clip, cropped to half the output frame around the face.
// The crop runs after the scale, so a shift is in output pixels.
const halfFrame = (scale, shift = '0') => {
  const k = (scale * FRAME.width) / STANDIN.window[0];
  const [cx, cy] = STANDIN.center.map((c) => Math.round(c * k));
  return [
    `scale=iw*${k}:ih*${k}:flags=bicubic`,
    `pad=iw+${2 * PAD}:ih+${2 * PAD}:${PAD}:${PAD}:color=0x808080`,
    `crop=${FRAME.width / 2}:${FRAME.height}:'${PAD + cx - FRAME.width / 4}-(${shift})':${PAD + cy - FRAME.height / 2}`,
  ].join(',');
};

// The user in the left half, rolled about its centre and shifted, the
// bystander still in the right half.
const twoFaceFilter = ({ userScale, bystanderScale, roll, shift }) => [
  'format=rgb24,split=2[user][bystander]',
  `[user]${halfFrame(userScale, motionExpression(shift))},rotate='(${motionExpression(roll)})*PI/180':c=0x808080[left]`,
  `[bystander]${halfFrame(userScale * bystanderScale)}[right]`,
  `[left][right]hstack=inputs=2,${NOISE},format=yuv420p`,
].join(';');

const buildTwoFace = (portrait, outDir) => {
  for (const condition of TWO_FACE) {
    const out = join(outDir, `${condition.id}.y4m`);
    ffmpeg([
      '-loop', '1', '-framerate', String(FRAME.fps), '-t', String(condition.clipSeconds), '-i', portrait,
      '-filter_complex', twoFaceFilter(condition), '-r', String(FRAME.fps), out,
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
  const portrait = fetchStandin(outDir);
  if (only === 'motion') throw new Error('--only motion needs --source recordings');
  if (only === 'all') buildSweeps(portrait, STANDIN, outDir);
  buildTwoFace(portrait, outDir);
} else if (source === 'recordings') {
  if (only === 'two-face') throw new Error('--only two-face needs --source standin');
  const still = firstFrame(join(RECORDINGS, 'static.mp4'), outDir);
  if (only === 'all') buildSweeps(still, { center: [FRAME.width / 2, FRAME.height / 2], window: [FRAME.width, FRAME.height] }, outDir);
  buildMotion(still, outDir);
  if (only === 'all') buildRecorded(outDir);
} else {
  throw new Error(`unknown source ${source}; use standin or recordings`);
}
