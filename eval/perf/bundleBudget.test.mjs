import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { BUDGETS, measureBundle, overBudget } from './bundleBudget.mjs';

const distWith = (files) => {
  const dist = mkdtempSync(join(tmpdir(), 'bundle-'));
  for (const [name, bytes] of Object.entries(files)) {
    mkdirSync(join(dist, name, '..'), { recursive: true });
    writeFileSync(join(dist, name), typeof bytes === 'number' ? randomBytes(bytes) : bytes);
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
    assert.deepEqual(raw, { mainJs: 100, workerJs: 50, css: 10, wasm: 30, wasmLoaderJs: 20, model: 40, glb: 99, otherJs: 7 });
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

// A dist folder at the committed budgets: the pinned files at their exact
// sizes, the scripts under their limits, the four product GLBs.
const { budgets } = JSON.parse(readFileSync(BUDGETS, 'utf8'));
const conformingDist = () =>
  distWith({
    'assets/index-AAAA.js': 'x'.repeat(900_000),
    'assets/landmarker.worker-BBBB.js': 'x'.repeat(150_000),
    'assets/index-CCCC.css': 'a{}'.repeat(3_000),
    'mediapipe/tasks-vision/1.2.3/vision_wasm_module_internal.wasm': Buffer.alloc(budgets.wasm.minRawBytes),
    'mediapipe/tasks-vision/1.2.3/vision_wasm_module_internal.js': Buffer.alloc(budgets.wasmLoaderJs.minRawBytes),
    'mediapipe/face_landmarker/float16/1/face_landmarker.task': Buffer.alloc(budgets.model.minRawBytes),
    'models/a.glb': 500_000,
    'models/b.glb': 500_000,
    'models/c.glb': 500_000,
    'models/d.glb': 500_000,
  });

const problemsAfter = (change) => {
  const dist = conformingDist();
  try {
    change(dist);
    return overBudget(measureBundle(dist), budgets);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
};

test('the committed budgets pass the build they describe', () => {
  assert.deepEqual(problemsAfter(() => {}), []);
});

test('the committed budgets fail each way a build can grow or lose a pinned file', () => {
  const put = (dist, name, content) => writeFileSync(join(dist, name), content);
  const cases = {
    'a lazy chunk named index-*.js': (dist) => put(dist, 'assets/index-DDDD.js', randomBytes(1_000)),
    'a lazy chunk emitted as .mjs': (dist) => put(dist, 'assets/stylist-EEEE.mjs', randomBytes(1_000)),
    'a renamed lazy chunk': (dist) => put(dist, 'assets/stylist-GGGG.js', randomBytes(1_000)),
    'the model replaced by a Git LFS pointer': (dist) => put(dist, 'mediapipe/face_landmarker/float16/1/face_landmarker.task', 'version https://git-lfs.github.com/spec/v1\n'),
    'the model missing': (dist) => rmSync(join(dist, 'mediapipe/face_landmarker'), { recursive: true }),
    'the WASM missing': (dist) => rmSync(join(dist, 'mediapipe/tasks-vision/1.2.3/vision_wasm_module_internal.wasm')),
    'a 20 MB GLB added': (dist) => put(dist, 'models/big.glb', Buffer.alloc(20_000_000)),
    'a second stylesheet': (dist) => put(dist, 'assets/other-HHHH.css', 'a{}'),
  };
  for (const [name, change] of Object.entries(cases)) {
    assert.notEqual(problemsAfter(change).length, 0, `${name} passed`);
  }
});

test('a budget key the checker does not know is reported', () => {
  assert.deepEqual(overBudget({}, { mainJs: { maxBytes: 1 } }), ['mainJs maxBytes: not a budget key']);
});
