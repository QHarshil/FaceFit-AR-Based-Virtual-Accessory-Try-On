import type { Vec2 } from '@facefit/cv';

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Maps a source pixel to a box pixel: `box = source * scale + offset`. */
export interface CoverFit {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * The layout `object-fit: cover` gives a source of intrinsic size `source` in
 * a box of size `box`: scaled uniformly until it fills the box, centred, with
 * the overflow cropped. The video and the WebGL canvas share one intrinsic
 * size and this fit, so a canvas pixel lands on the video pixel it was
 * rendered for. Returns null for a non-positive size.
 */
export function coverFit(source: Size, box: Size): CoverFit | null {
  if (![source.width, source.height, box.width, box.height].every((v) => v > 0)) return null;
  const scale = Math.max(box.width / source.width, box.height / source.height);
  return {
    scale,
    offsetX: (box.width - source.width * scale) / 2,
    offsetY: (box.height - source.height * scale) / 2,
  };
}

export function sourceToBox(fit: CoverFit, [u, v]: Vec2): Vec2 {
  return [u * fit.scale + fit.offsetX, v * fit.scale + fit.offsetY];
}
