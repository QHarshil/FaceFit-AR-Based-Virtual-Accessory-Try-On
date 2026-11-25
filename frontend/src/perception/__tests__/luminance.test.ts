import { describe, expect, it } from 'vitest';
import { meanLuma } from '../luminance';

const pixels = (...rgb: [number, number, number][]) =>
  new Uint8ClampedArray(rgb.flatMap(([r, g, b]) => [r, g, b, 255]));

describe('meanLuma', () => {
  it('weights channels by Rec. 601', () => {
    expect(meanLuma(pixels([255, 0, 0]))).toBeCloseTo(76.245, 3);
    expect(meanLuma(pixels([0, 255, 0]))).toBeCloseTo(149.685, 3);
    expect(meanLuma(pixels([0, 0, 255]))).toBeCloseTo(29.07, 3);
  });

  it('averages over pixels and ignores alpha', () => {
    expect(meanLuma(pixels([0, 0, 0], [255, 255, 255]))).toBeCloseTo(127.5, 6);
    expect(meanLuma(new Uint8ClampedArray([100, 100, 100, 0]))).toBeCloseTo(100, 6);
  });

  it('returns null for no pixels', () => {
    expect(meanLuma(new Uint8ClampedArray(0))).toBeNull();
  });
});
