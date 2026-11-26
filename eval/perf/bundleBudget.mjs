#!/usr/bin/env node
// Sizes of the production build's assets against budgets.json.
//
//   node perf/bundleBudget.mjs [--dist <dir>]            checks; exit 1 over budget
//   node perf/bundleBudget.mjs --write --label <name>    also writes results.json (clean tree)
//
// Raw and brotli sizes are taken from the files in `dist`, so the numbers are
// what the host serves before transfer encoding.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirtyPaths, gitIn, startCommit } from '../harness/provenance.mjs';

const EVAL = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(EVAL, '..');
export const BUDGETS = join(EVAL, 'perf', 'budgets.json');

// The asset classes a budget names. A script that matches none is `otherJs`,
// so a split chunk shows up as a failure instead of escaping the budget.
// `.mjs` counts as a script, and a second `index-*.js` raises `mainJs` past its
// `files` count.
export const CLASSES = [
  ['mainJs', /^assets\/index-[^/]+\.js$/],
  ['workerJs', /^assets\/landmarker\.worker-[^/]+\.js$/],
  ['css', /\.css$/],
  ['wasm', /\.wasm$/],
  ['wasmLoaderJs', /^mediapipe\/.*\.m?js$/],
  ['model', /\.task$/],
  ['glb', /\.glb$/],
  ['otherJs', /\.m?js$/],
];

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const compressed = (buffer) => ({
  rawBytes: buffer.length,
  gzipBytes: gzipSync(buffer, { level: 9 }).length,
  brotliBytes: brotliCompressSync(buffer, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
});

/** Per class: file count and summed raw, gzip and brotli bytes. */
export const measureBundle = (dist) => {
  const sizes = Object.fromEntries(CLASSES.map(([name]) => [name, { files: [], rawBytes: 0, gzipBytes: 0, brotliBytes: 0 }]));
  for (const path of walk(dist).sort()) {
    const name = relative(dist, path).split('\\').join('/');
    const [cls] = CLASSES.find(([, pattern]) => pattern.test(name)) ?? [];
    if (!cls) continue;
    const size = compressed(readFileSync(path));
    sizes[cls].files.push(name);
    for (const key of ['rawBytes', 'gzipBytes', 'brotliBytes']) sizes[cls][key] += size[key];
  }
  return sizes;
};

const LIMIT_KEYS = {
  files: (size) => size.files.length,
  minRawBytes: (size) => size.rawBytes,
  maxRawBytes: (size) => size.rawBytes,
  maxBrotliBytes: (size) => size.brotliBytes,
};

/**
 * Problems, one line each, for every class whose file count is not `files`,
 * whose raw size is under `minRawBytes` or over `maxRawBytes`, or whose brotli
 * size is over `maxBrotliBytes`. A class with no files measures 0, so a
 * missing model or WASM fails its minimum and its count.
 */
export const overBudget = (sizes, budgets) =>
  Object.entries(budgets).flatMap(([cls, limits]) =>
    Object.entries(limits).flatMap(([key, limit]) => {
      const measure = LIMIT_KEYS[key];
      if (!measure) return [`${cls} ${key}: not a budget key`];
      const size = sizes[cls] ?? { files: [], rawBytes: 0, gzipBytes: 0, brotliBytes: 0 };
      const measured = measure(size);
      if (key === 'files') return measured === limit ? [] : [`${cls} files: ${measured} != ${limit} (${size.files.join(', ') || 'none'})`];
      if (key === 'minRawBytes') return measured < limit ? [`${cls} ${key}: ${measured} < ${limit}`] : [];
      return measured > limit ? [`${cls} ${key}: ${measured} > ${limit}`] : [];
    }),
  );

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = resolve(arg('dist') ?? join(REPO, 'frontend', 'dist'));
  if (!existsSync(dist)) throw new Error(`${dist} is missing; run npm --prefix frontend run build`);
  const budgets = JSON.parse(readFileSync(BUDGETS, 'utf8')).budgets;
  const sizes = measureBundle(dist);
  for (const [cls, size] of Object.entries(sizes)) {
    console.log(`${cls.padEnd(12)} ${String(size.files.length).padStart(2)} files  raw ${String(size.rawBytes).padStart(9)}  gzip ${String(size.gzipBytes).padStart(9)}  brotli ${String(size.brotliBytes).padStart(9)}`);
  }
  const problems = overBudget(sizes, budgets);
  if (process.argv.includes('--write')) {
    const git = gitIn(REPO);
    const dirty = dirtyPaths(git);
    if (dirty.length) throw new Error(`working tree is dirty; commit first\n${dirty.join('\n')}`);
    const results = JSON.parse(readFileSync(join(EVAL, 'results.json'), 'utf8'));
    results.runs[arg('label') ?? 'bundle-size'] = {
      measuredAt: new Date().toISOString(),
      commit: startCommit(git),
      dirty: false,
      command: `node eval/perf/bundleBudget.mjs --write --label ${arg('label') ?? 'bundle-size'}`,
      input: 'frontend production build (npm run build) with VITE_API_URL unset; sizes of the files in dist, brotli quality 11 and gzip level 9',
      node: process.version,
      sizes,
      budgets,
      overBudget: problems,
    };
    writeFileSync(join(EVAL, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
    console.log('wrote eval/results.json');
  }
  if (problems.length) {
    console.error(`over budget\n${problems.join('\n')}`);
    process.exit(1);
  }
}
