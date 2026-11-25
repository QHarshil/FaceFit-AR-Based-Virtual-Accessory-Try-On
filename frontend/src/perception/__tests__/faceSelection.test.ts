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
  type Selector = ReturnType<typeof createTrackedFaceSelector>;
  const indexOf = (selector: Selector, faces: LandmarkPoint[][]) =>
    selector.select(faces, WIDTH, HEIGHT)?.index ?? null;

  it('tracks the largest face by inter-ocular distance whatever the order', () => {
    expect(
      indexOf(createTrackedFaceSelector(), [faceAt(300, 360, 90), faceAt(900, 360, 120)]),
    ).toBe(1);
    expect(
      indexOf(createTrackedFaceSelector(), [faceAt(900, 360, 120), faceAt(300, 360, 90)]),
    ).toBe(0);
    expect(indexOf(createTrackedFaceSelector(), [])).toBeNull();
  });

  it('keeps the tracked face against a similar one, even when MediaPipe reorders them', () => {
    const selector = createTrackedFaceSelector();
    const first = selector.select([faceAt(300, 360, 100), faceAt(900, 360, 95)], WIDTH, HEIGHT);
    expect(first?.index).toBe(0);
    // The other face grows past the tracked one, but not by the switch ratio.
    expect(selector.select([faceAt(905, 362, 110), faceAt(302, 360, 100)], WIDTH, HEIGHT)).toEqual({
      index: 1,
      trackId: first?.trackId,
    });
    expect(
      indexOf(selector, [faceAt(304, 361, 100), faceAt(908, 360, 100 * SWITCH_RATIO - 1)]),
    ).toBe(0);
  });

  it('switches to a new track when another face is larger by more than the switch ratio', () => {
    const selector = createTrackedFaceSelector();
    const first = selector.select([faceAt(300, 360, 100), faceAt(900, 360, 95)], WIDTH, HEIGHT);
    const second = selector.select(
      [faceAt(300, 360, 100), faceAt(900, 360, 100 * SWITCH_RATIO + 1)],
      WIDTH,
      HEIGHT,
    );
    expect(second?.index).toBe(1);
    expect(second?.trackId).not.toBe(first?.trackId);
    // The new face is now the tracked one.
    expect(selector.select([faceAt(902, 360, 120), faceAt(300, 360, 110)], WIDTH, HEIGHT)).toEqual({
      index: 0,
      trackId: second?.trackId,
    });
  });

  it('picks the largest again once the tracked face is gone or the frame is empty', () => {
    const selector = createTrackedFaceSelector();
    expect(indexOf(selector, [faceAt(300, 360, 120), faceAt(900, 360, 100)])).toBe(0);
    // Nothing within one inter-ocular distance of the tracked face.
    expect(indexOf(selector, [faceAt(900, 360, 100), faceAt(600, 200, 90)])).toBe(0);
    expect(indexOf(selector, [])).toBeNull();
    expect(indexOf(selector, [faceAt(600, 200, 90), faceAt(900, 360, 100)])).toBe(1);
  });
});
