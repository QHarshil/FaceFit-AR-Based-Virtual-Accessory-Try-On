import { describe, expect, it } from 'vitest';
import { createTrackedFaceSelector, SWITCH_RATIO } from '../faceSelection';
import { LANDMARK_COUNT, type LandmarkPoint } from '../types';

const WIDTH = 1280;
const HEIGHT = 720;

/** A face centred at (x, y) page pixels whose outer eye corners are `interocularPx` apart. */
const faceAt = (x: number, y: number, interocularPx: number): LandmarkPoint[] =>
  Array.from({ length: LANDMARK_COUNT }, (_, i) => {
    const dx = i === 33 ? -interocularPx / 2 : i === 263 ? interocularPx / 2 : 0;
    return { x: (x + dx) / WIDTH, y: y / HEIGHT, z: 0 };
  });

describe('createTrackedFaceSelector', () => {
  it('tracks the largest face by inter-ocular distance whatever the order', () => {
    expect(
      createTrackedFaceSelector().select(
        [faceAt(300, 360, 90), faceAt(900, 360, 120)],
        WIDTH,
        HEIGHT,
      ),
    ).toBe(1);
    expect(
      createTrackedFaceSelector().select(
        [faceAt(900, 360, 120), faceAt(300, 360, 90)],
        WIDTH,
        HEIGHT,
      ),
    ).toBe(0);
    expect(createTrackedFaceSelector().select([], WIDTH, HEIGHT)).toBeNull();
  });

  it('keeps the tracked face against a similar one, even when MediaPipe reorders them', () => {
    const selector = createTrackedFaceSelector();
    expect(selector.select([faceAt(300, 360, 100), faceAt(900, 360, 95)], WIDTH, HEIGHT)).toBe(0);
    // The other face grows past the tracked one, but not by the switch ratio.
    expect(selector.select([faceAt(905, 362, 110), faceAt(302, 360, 100)], WIDTH, HEIGHT)).toBe(1);
    expect(
      selector.select(
        [faceAt(304, 361, 100), faceAt(908, 360, 100 * SWITCH_RATIO - 1)],
        WIDTH,
        HEIGHT,
      ),
    ).toBe(0);
  });

  it('switches when another face is larger by more than the switch ratio', () => {
    const selector = createTrackedFaceSelector();
    expect(selector.select([faceAt(300, 360, 100), faceAt(900, 360, 95)], WIDTH, HEIGHT)).toBe(0);
    expect(
      selector.select(
        [faceAt(300, 360, 100), faceAt(900, 360, 100 * SWITCH_RATIO + 1)],
        WIDTH,
        HEIGHT,
      ),
    ).toBe(1);
    // The new face is now the tracked one.
    expect(selector.select([faceAt(902, 360, 120), faceAt(300, 360, 110)], WIDTH, HEIGHT)).toBe(0);
  });

  it('picks the largest again once the tracked face is gone or the frame is empty', () => {
    const selector = createTrackedFaceSelector();
    expect(selector.select([faceAt(300, 360, 120), faceAt(900, 360, 100)], WIDTH, HEIGHT)).toBe(0);
    // Nothing within one inter-ocular distance of the tracked face.
    expect(selector.select([faceAt(900, 360, 100), faceAt(600, 200, 90)], WIDTH, HEIGHT)).toBe(0);
    expect(selector.select([], WIDTH, HEIGHT)).toBeNull();
    expect(selector.select([faceAt(600, 200, 90), faceAt(900, 360, 100)], WIDTH, HEIGHT)).toBe(1);
  });
});
