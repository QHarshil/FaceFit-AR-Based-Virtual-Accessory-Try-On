import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as camera from '../src/camera.ts';
import * as faceModel from '../src/faceModel.ts';
import * as api from '../src/index.ts';
import * as pnp from '../src/pnp.ts';
import * as aggregate from '../src/scale/aggregate.ts';
import * as faceScale from '../src/scale/faceScale.ts';
import * as frame from '../src/scale/frame.ts';
import * as iris from '../src/scale/iris.ts';
import * as landmarks from '../src/scale/landmarks.ts';
import * as measurements from '../src/scale/measurements.ts';

describe('README', () => {
  it('names every public camera, face model, solver and scale export', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    const documented = [camera, faceModel, pnp, aggregate, faceScale, frame, iris, landmarks, measurements].flatMap((module) => Object.keys(module)).filter((name) => name in api);
    expect(documented.length).toBeGreaterThan(0);
    for (const name of documented) expect(readme, name).toContain(`\`${name}`);
  });
});
