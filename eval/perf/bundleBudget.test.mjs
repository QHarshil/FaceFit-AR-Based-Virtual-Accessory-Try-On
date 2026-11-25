import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { measureBundle, overBudget } from './bundleBudget.mjs';

const distWith = (files) => {
  const dist = mkdtempSync(join(tmpdir(), 'bundle-'));
  for (const [name, bytes] of Object.entries(files)) {
    mkdirSync(join(dist, name, '..'), { recursive: true });
    writeFileSync(join(dist, name), randomBytes(bytes));
  }
  return dist;
};

test('files fall into the asset classes a budget names', () => {
  const dist = distWith({
    'assets/index-abc.js': 100,
    'assets/landmarker.worker-def.js': 50,
    'assets/index-xyz.css': 10,
    'assets/chunk-new.js': 7,
    'mediapipe/loader.js': 20,
    'mediapipe/engine.wasm': 30,
    'mediapipe/face.task': 40,
    'models/frame.glb': 99,
  });
  try {
    const sizes = measureBundle(dist);
    const raw = Object.fromEntries(Object.entries(sizes).map(([cls, size]) => [cls, size.rawBytes]));
    assert.deepEqual(raw, { mainJs: 100, workerJs: 50, css: 10, wasm: 30, wasmLoaderJs: 20, model: 40, otherJs: 7 });
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('a class over its raw or brotli budget is reported, and a new JS chunk fails otherJs', () => {
  const dist = distWith({ 'assets/index-abc.js': 1000, 'assets/chunk-new.js': 7 });
  try {
    const sizes = measureBundle(dist);
    const budgets = {
      mainJs: { maxRawBytes: 999, maxBrotliBytes: 100_000 },
      otherJs: { maxRawBytes: 0 },
      css: { maxRawBytes: 0 },
    };
    assert.deepEqual(overBudget(sizes, budgets), ['mainJs maxRawBytes: 1000 > 999', 'otherJs maxRawBytes: 7 > 0']);
    assert.deepEqual(overBudget(sizes, { mainJs: { maxRawBytes: 1000, maxBrotliBytes: sizes.mainJs.brotliBytes } }), []);
    assert.deepEqual(overBudget(sizes, { mainJs: { maxBrotliBytes: sizes.mainJs.brotliBytes - 1 } }), [
      `mainJs maxBrotliBytes: ${sizes.mainJs.brotliBytes} > ${sizes.mainJs.brotliBytes - 1}`,
    ]);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
