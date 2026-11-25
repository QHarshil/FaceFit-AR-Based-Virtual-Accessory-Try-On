// Mean brightness of a camera frame, measured in the worker on a small
// downscaled copy so it costs one tiny readback.

/** Size of the copy the luma is averaged over. */
export const LUMINANCE_SAMPLE_SIZE = { width: 32, height: 18 } as const;

/** Frames between brightness samples: twice a second at 30 Hz. */
export const LUMINANCE_SAMPLE_INTERVAL = 15;

/** Mean Rec. 601 luma of RGBA pixels, 0 to 255. Null for an empty buffer. */
export const meanLuma = (rgba: ArrayLike<number>): number | null => {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0) return null;
  let sum = 0;
  for (let i = 0; i < pixels * 4; i += 4) {
    sum +=
      0.299 * (rgba[i] as number) +
      0.587 * (rgba[i + 1] as number) +
      0.114 * (rgba[i + 2] as number);
  }
  return sum / pixels;
};
