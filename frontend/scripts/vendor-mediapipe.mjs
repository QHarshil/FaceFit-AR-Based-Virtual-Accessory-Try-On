#!/usr/bin/env node
// Puts the pinned MediaPipe runtime and face model under public/mediapipe, so
// the app serves them from its own origin. The WASM pair is copied from the
// installed @mediapipe/tasks-vision; the model is downloaded once. Every file
// is checked against the size and SHA-256 pinned here, so an upgrade fails
// until these pins and src/perception/README.md are updated together.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = join(FRONTEND, 'node_modules', '@mediapipe', 'tasks-vision');
const OUT = join(FRONTEND, 'public', 'mediapipe');

const TASKS_VISION_VERSION = '1.2.3';

const WASM = [
  {
    name: 'vision_wasm_module_internal.js',
    bytes: 336662,
    sha256: 'd29996249490361715c769c6a49b43ad47e6ac9a28a8e8bce8d02b238e897851',
  },
  {
    name: 'vision_wasm_module_internal.wasm',
    bytes: 14665738,
    sha256: 'a269e84b12aefc93c9d6a4d62b01f41e5434a9fa941533bb8e75b1e3d1669e46',
  },
];

const MODEL = {
  url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  path: join(OUT, 'face_landmarker', 'float16', '1', 'face_landmarker.task'),
  bytes: 3758596,
  sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
};

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const verify = (label, buffer, { bytes, sha256: expected }) => {
  const digest = sha256(buffer);
  if (buffer.length !== bytes || digest !== expected) {
    throw new Error(
      `${label}: expected ${bytes} bytes sha256 ${expected}, got ${buffer.length} bytes sha256 ${digest}`,
    );
  }
};

const writeAtomic = (path, buffer) => {
  mkdirSync(dirname(path), { recursive: true });
  const partial = `${path}.partial`;
  writeFileSync(partial, buffer);
  renameSync(partial, path);
};

const vendorWasm = () => {
  const { version } = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8'));
  if (version !== TASKS_VISION_VERSION) {
    throw new Error(
      `@mediapipe/tasks-vision ${version} is installed but ${TASKS_VISION_VERSION} is pinned`,
    );
  }
  const root = join(OUT, 'tasks-vision');
  // Only the installed version stays, so an upgrade cannot leave stale WASM behind.
  rmSync(root, { recursive: true, force: true });
  for (const file of WASM) {
    const buffer = readFileSync(join(PACKAGE, 'wasm', file.name));
    verify(file.name, buffer, file);
    writeAtomic(join(root, version, file.name), buffer);
  }
};

const vendorModel = async () => {
  if (existsSync(MODEL.path) && sha256(readFileSync(MODEL.path)) === MODEL.sha256) return;
  const response = await fetch(MODEL.url);
  if (!response.ok) throw new Error(`face_landmarker.task: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  verify('face_landmarker.task', buffer, MODEL);
  writeAtomic(MODEL.path, buffer);
};

try {
  vendorWasm();
  await vendorModel();
  console.log(`MediaPipe assets ready in ${relative(FRONTEND, OUT)}`);
} catch (error) {
  console.error(`vendor-mediapipe: ${error.message}`);
  process.exit(1);
}
