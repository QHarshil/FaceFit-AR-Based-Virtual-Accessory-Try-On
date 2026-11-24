import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

// The image builds from the repository root. npm run build generates the cv
// declarations and copies the models, so it needs these files beside frontend/.
describe('frontend Dockerfile', () => {
  const copied = read('../../Dockerfile')
    .split('\n')
    .filter((line) => line.startsWith('COPY ') && !line.includes('--from'))
    .flatMap((line) => line.slice('COPY '.length).trim().split(/\s+/).slice(0, -1));

  it.each([
    // tsconfig.types.json extends it.
    'packages/cv/tsconfig.json',
    'packages/cv/tsconfig.types.json',
    // Its "type": "module" makes nodenext read the sources as ES modules.
    'packages/cv/package.json',
    'packages/cv/src',
    'assets/out',
  ])('copies %s for the build', (path) => {
    expect(copied).toContain(path);
  });
});
