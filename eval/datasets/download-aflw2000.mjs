#!/usr/bin/env node
// Fetches AFLW2000-3D, checks its SHA-256 and unpacks it into
// eval/.cache/datasets/AFLW2000. The data is never committed; see README.md.
//
//   node eval/datasets/download-aflw2000.mjs
//   node eval/datasets/download-aflw2000.mjs --zip <path>   (use a local copy; still hash-checked)
//
// The 3DDFA page's link answers 404 since 2026, so the Internet Archive's
// capture of the same URL is the fallback. The pinned hash and size match the
// checksum TensorFlow Datasets records for the original URL, so either source
// yields the original archive or nothing.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGINAL_URL = 'http://www.cbsr.ia.ac.cn/users/xiangyuzhu/projects/3DDFA/Database/AFLW2000-3D.zip';
const SOURCES = [ORIGINAL_URL, `https://web.archive.org/web/20260405220653id_/${ORIGINAL_URL}`];
export const AFLW2000_SHA256 = '252bc35274d65ff27b6e573aa96c2f4c116ad88452cc984fb882258c0ed6e2d8';
export const AFLW2000_BYTES = 87413900;
export const AFLW2000_SAMPLES = 2000;
// The archive server drops long transfers, so the file comes in ranged chunks.
const CHUNK_BYTES = 4 * 2 ** 20;
const CHUNK_TIMEOUT_MS = 120_000;
const MAX_CHUNK_FAILURES = 10;

const CACHE = join(dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'datasets');
export const AFLW2000_DIR = join(CACHE, 'AFLW2000');
const ZIP_PATH = join(CACHE, 'AFLW2000-3D.zip');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Image and label file names that both exist, sorted. */
export function aflw2000Samples(dir = AFLW2000_DIR) {
  if (!existsSync(dir)) return [];
  const files = new Set(readdirSync(dir));
  return [...files]
    .filter((name) => /^image\d{5}\.jpg$/.test(name) && files.has(name.replace(/\.jpg$/, '.mat')))
    .map((name) => name.replace(/\.jpg$/, ''))
    .sort();
}

class SourceGone extends Error {}

async function fetchChunk(url, start, end) {
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS) });
  if (response.status >= 400 && response.status < 500) throw new SourceGone(`HTTP ${response.status}`);
  if (response.status !== 206) throw new Error(`HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== end - start + 1) throw new Error(`got ${bytes.length} bytes for range ${start}-${end}`);
  return bytes;
}

async function download(url) {
  const chunks = [];
  let have = 0;
  let failures = 0;
  while (have < AFLW2000_BYTES) {
    const end = Math.min(have + CHUNK_BYTES, AFLW2000_BYTES) - 1;
    try {
      const chunk = await fetchChunk(url, have, end);
      chunks.push(chunk);
      have += chunk.length;
      process.stdout.write(`\r${(have / 2 ** 20).toFixed(0)} of ${(AFLW2000_BYTES / 2 ** 20).toFixed(0)} MB`);
    } catch (error) {
      failures += 1;
      if (error instanceof SourceGone || failures >= MAX_CHUNK_FAILURES) throw error;
    }
  }
  process.stdout.write('\n');
  return Buffer.concat(chunks);
}

/** Throws unless the bytes are the pinned archive. */
function verifyArchive(archive, origin) {
  const digest = sha256(archive);
  if (archive.length !== AFLW2000_BYTES || digest !== AFLW2000_SHA256) {
    throw new Error(`${origin}: ${archive.length} bytes with SHA-256 ${digest}; expected ${AFLW2000_BYTES} bytes, ${AFLW2000_SHA256}`);
  }
  return archive;
}

async function obtainArchive(zipArg) {
  if (zipArg) return verifyArchive(readFileSync(resolve(zipArg)), zipArg);
  if (existsSync(ZIP_PATH)) {
    try {
      return verifyArchive(readFileSync(ZIP_PATH), ZIP_PATH);
    } catch (error) {
      console.log(`ignoring cached archive. ${error.message}`);
    }
  }
  for (const url of SOURCES) {
    console.log(`fetching ${url}`);
    try {
      return verifyArchive(await download(url), url);
    } catch (error) {
      console.log(`  failed: ${error.message}`);
    }
  }
  throw new Error('no source delivered the pinned archive');
}

/** Entry names that could land outside AFLW2000/ when unpacked. */
export function unsafeEntries(names) {
  return names.filter((name) => !name.startsWith('AFLW2000/') || name.split('/').includes('..') || name.includes('\\'));
}

function checkEntries(zipPath) {
  const names = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8', maxBuffer: 2 ** 24 }).split('\n').filter(Boolean);
  const unsafe = unsafeEntries(names);
  if (unsafe.length) throw new Error(`archive has entries outside AFLW2000/: ${unsafe.slice(0, 3).join(', ')}`);
}

async function main() {
  const zipIndex = process.argv.indexOf('--zip');
  const zipArg = zipIndex > 0 ? process.argv[zipIndex + 1] : null;
  if (aflw2000Samples().length === AFLW2000_SAMPLES) {
    console.log(`${AFLW2000_DIR} already holds ${AFLW2000_SAMPLES} samples`);
    return;
  }
  mkdirSync(CACHE, { recursive: true });
  const archive = await obtainArchive(zipArg);
  if (!existsSync(ZIP_PATH) || !readFileSync(ZIP_PATH).equals(archive)) writeFileSync(ZIP_PATH, archive);
  checkEntries(ZIP_PATH);

  const staging = join(CACHE, 'unpacking');
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging);
  execFileSync('unzip', ['-q', ZIP_PATH, '-d', staging]);
  const count = aflw2000Samples(join(staging, 'AFLW2000')).length;
  if (count !== AFLW2000_SAMPLES) throw new Error(`unpacked ${count} image and label pairs, expected ${AFLW2000_SAMPLES}`);
  rmSync(AFLW2000_DIR, { recursive: true, force: true });
  renameSync(join(staging, 'AFLW2000'), AFLW2000_DIR);
  rmSync(staging, { recursive: true, force: true });
  console.log(`unpacked ${count} samples into ${AFLW2000_DIR}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
