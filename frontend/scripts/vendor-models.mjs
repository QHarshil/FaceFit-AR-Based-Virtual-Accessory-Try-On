#!/usr/bin/env node
// Puts the normalized glasses models from assets/out under public/models, so
// the app serves the files `npm run normalize` wrote. Each file is checked
// against the SHA-256 in assets/out/manifest.json, written in the same run.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(FRONTEND, '..', 'assets', 'out');
const OUT = join(FRONTEND, 'public', 'models');

try {
  const manifest = JSON.parse(readFileSync(join(SOURCE, 'manifest.json'), 'utf8'));
  // Only the listed models stay, so a model dropped from the catalog cannot linger.
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const { slug, sha256 } of manifest) {
    const name = `${slug}.glb`;
    const buffer = readFileSync(join(SOURCE, name));
    const digest = createHash('sha256').update(buffer).digest('hex');
    if (digest !== sha256) throw new Error(`${name}: expected sha256 ${sha256}, got ${digest}`);
    writeFileSync(join(OUT, name), buffer);
  }
  console.log(`${manifest.length} models ready in ${relative(FRONTEND, OUT)}`);
} catch (error) {
  console.error(`vendor-models: ${error.message}`);
  process.exit(1);
}
