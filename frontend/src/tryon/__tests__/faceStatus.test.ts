import { describe, expect, it } from 'vitest';
import {
  createFaceStatusTracker,
  DEFAULT_FACE_STATUS_OPTIONS,
  faceStateOf,
  NO_FACE,
  type FaceFrame,
} from '../faceStatus';

const { lostAfterFrames, countAfterFrames, darkBelow, brightAbove, darkSamples } =
  DEFAULT_FACE_STATUS_OPTIONS;

const ONE: FaceFrame = { faceCount: 1, tracked: true };
const TWO: FaceFrame = { faceCount: 2, tracked: true };
const NONE: FaceFrame = { faceCount: 0, tracked: false };

const feed = (frames: FaceFrame[]) => {
  const tracker = createFaceStatusTracker();
  return frames.map((frame) => tracker.update(frame));
};

const repeat = (frame: FaceFrame, count: number) => Array<FaceFrame>(count).fill(frame);

describe('faceStateOf', () => {
  it.each([
    [{ faces: 2, tracked: true, lowLight: false }, 'multiple'],
    [{ faces: 1, tracked: true, lowLight: true }, 'tracking'],
    [{ faces: 0, tracked: false, lowLight: true }, 'lowLight'],
    [{ faces: 1, tracked: false, lowLight: false }, 'none'],
  ] as const)('maps %o to %s', (status, state) => {
    expect(faceStateOf(status)).toBe(state);
  });
});

describe('createFaceStatusTracker', () => {
  it('reports a face on its first frame', () => {
    expect(feed([ONE])[0]).toEqual({ faces: 1, tracked: true, lowLight: false });
  });

  it('keeps the face through a short miss and loses it after lostAfterFrames', () => {
    const statuses = feed([ONE, ...repeat(NONE, lostAfterFrames)]);
    expect(statuses[lostAfterFrames - 1]?.tracked).toBe(true);
    expect(statuses[lostAfterFrames]?.tracked).toBe(false);
  });

  it('reports a second face only once it stays for countAfterFrames', () => {
    const statuses = feed([ONE, ...repeat(TWO, countAfterFrames)]);
    expect(statuses[countAfterFrames - 1]?.faces).toBe(1);
    expect(statuses[countAfterFrames]?.faces).toBe(2);
  });

  it('ignores a second face that flickers in and out', () => {
    const flicker = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? TWO : ONE));
    expect(feed([ONE, ...flicker]).every((status) => status.faces === 1)).toBe(true);
  });

  it('reports low light after darkSamples dark samples and clears it above brightAbove', () => {
    const dark = { ...NONE, luminance: darkBelow - 1 };
    const between = { ...NONE, luminance: (darkBelow + brightAbove) / 2 };
    const bright = { ...NONE, luminance: brightAbove + 1 };
    const statuses = feed([...repeat(dark, darkSamples), between, NONE, bright]);
    expect(statuses[darkSamples - 2]?.lowLight).toBe(false);
    expect(statuses[darkSamples - 1]?.lowLight).toBe(true);
    // Between the two thresholds, and on unsampled frames, the state holds.
    expect(statuses[darkSamples]?.lowLight).toBe(true);
    expect(statuses[darkSamples + 1]?.lowLight).toBe(true);
    expect(statuses[darkSamples + 2]?.lowLight).toBe(false);
  });

  it('returns the same object while nothing changes, for useSyncExternalStore', () => {
    const statuses = feed(repeat(ONE, 5));
    expect(new Set(statuses).size).toBe(1);
  });

  it('starts over on reset', () => {
    const tracker = createFaceStatusTracker();
    tracker.update(ONE);
    tracker.reset();
    expect(tracker.update(NONE)).toBe(NO_FACE);
  });
});
