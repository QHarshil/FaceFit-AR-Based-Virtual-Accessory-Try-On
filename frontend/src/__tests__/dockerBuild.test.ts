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

// docker-compose v1 reads only the root .dockerignore, so it has to keep the
// recordings, the cache, secrets and host dependencies out of every context.
describe('root .dockerignore', () => {
  const patterns = read('../../../.dockerignore')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

  it.each([
    'eval/fixtures/recordings',
    'eval/.cache',
    '**/node_modules',
    '**/.env*',
    '**/dist',
    '**/.data',
    '.git',
  ])('excludes %s', (path) => {
    expect(patterns).toContain(path);
  });

  it('keeps the files the images copy', () => {
    for (const path of [
      'assets/out',
      'assets/catalog.json',
      'packages/cv',
      'frontend',
      'backend',
    ]) {
      expect(patterns).not.toContain(path);
    }
  });
});

describe('start.sh', () => {
  const script = read('../../../start.sh');

  it('requires docker compose v2', () => {
    expect(script).toContain('docker compose version');
    expect(script).not.toContain('docker-compose');
  });
});
