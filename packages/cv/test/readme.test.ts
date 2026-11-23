import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as camera from '../src/camera.ts';
import * as faceModel from '../src/faceModel.ts';
import * as api from '../src/index.ts';
import * as pnp from '../src/pnp.ts';

describe('README', () => {
  it('names every public camera, face model and solver export', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    const documented = [camera, faceModel, pnp].flatMap((module) => Object.keys(module)).filter((name) => name in api);
    expect(documented.length).toBeGreaterThan(0);
    for (const name of documented) expect(readme, name).toContain(`\`${name}`);
  });
});
