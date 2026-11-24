import { describe, expect, it } from 'vitest';
import { coverFit, sourceToBox, type Size } from '../coverFit';

const CASES: { name: string; source: Size; box: Size }[] = [
  {
    name: 'same aspect, larger box',
    source: { width: 1280, height: 720 },
    box: { width: 1920, height: 1080 },
  },
  {
    name: 'wider box crops top and bottom',
    source: { width: 1280, height: 720 },
    box: { width: 1600, height: 600 },
  },
  {
    name: 'portrait phone crops the sides',
    source: { width: 1280, height: 720 },
    box: { width: 390, height: 844 },
  },
  {
    name: '4:3 camera in a 16:9 page',
    source: { width: 640, height: 480 },
    box: { width: 1280, height: 720 },
  },
  {
    name: 'portrait camera in a landscape page',
    source: { width: 720, height: 1280 },
    box: { width: 1280, height: 720 },
  },
];

describe('coverFit', () => {
  it.each(CASES)(
    '$name: fills the box, keeps the aspect and centres the source',
    ({ source, box }) => {
      const fit = coverFit(source, box);
      expect(fit).not.toBeNull();
      if (!fit) return;
      const [left, top] = sourceToBox(fit, [0, 0]);
      const [right, bottom] = sourceToBox(fit, [source.width, source.height]);
      // Uniform scale: the source aspect survives.
      expect((right - left) / (bottom - top)).toBeCloseTo(source.width / source.height, 9);
      // Covers the box, and one axis fits exactly so nothing more is cropped than needed.
      expect(left).toBeLessThanOrEqual(1e-9);
      expect(top).toBeLessThanOrEqual(1e-9);
      expect(right).toBeGreaterThanOrEqual(box.width - 1e-9);
      expect(bottom).toBeGreaterThanOrEqual(box.height - 1e-9);
      expect(Math.min(Math.abs(left), Math.abs(top))).toBeLessThan(1e-9);
      const [cx, cy] = sourceToBox(fit, [source.width / 2, source.height / 2]);
      expect(cx).toBeCloseTo(box.width / 2, 9);
      expect(cy).toBeCloseTo(box.height / 2, 9);
    },
  );

  it('crops 150 px from the top and bottom of a 1280x720 video in a 1600x600 box', () => {
    const fit = coverFit({ width: 1280, height: 720 }, { width: 1600, height: 600 });
    expect(fit).toEqual({ scale: 1.25, offsetX: 0, offsetY: -150 });
    // Video row 120 is the first one on screen.
    expect(sourceToBox(fit!, [640, 120])).toEqual([800, 0]);
  });

  it('crops the sides of a 1280x720 video on a 390x844 phone screen', () => {
    const fit = coverFit({ width: 1280, height: 720 }, { width: 390, height: 844 })!;
    expect(fit.scale).toBeCloseTo(844 / 720, 12);
    expect(fit.offsetY).toBe(0);
    // The visible strip is the middle 390 / scale video pixels.
    const visible = 390 / fit.scale;
    expect(sourceToBox(fit, [640 - visible / 2, 360])[0]).toBeCloseTo(0, 9);
    expect(sourceToBox(fit, [640 + visible / 2, 360])[0]).toBeCloseTo(390, 9);
  });

  it('returns null for an empty source or box', () => {
    expect(coverFit({ width: 0, height: 720 }, { width: 1280, height: 720 })).toBeNull();
    expect(coverFit({ width: 1280, height: 720 }, { width: 1280, height: 0 })).toBeNull();
  });
});
