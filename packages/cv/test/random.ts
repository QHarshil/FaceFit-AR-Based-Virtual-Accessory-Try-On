/** Seeded generator so every synthetic trial is reproducible. Mulberry32. */
export interface SeededRandom {
  uniform(min?: number, max?: number): number;
  gaussian(sigma?: number): number;
  integer(maxExclusive: number): number;
}

export function seededRandom(seed: number): SeededRandom {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spareGaussian: number | null = null;
  return {
    uniform(min = 0, max = 1) {
      return min + (max - min) * next();
    },
    gaussian(sigma = 1) {
      if (spareGaussian !== null) {
        const value = spareGaussian;
        spareGaussian = null;
        return value * sigma;
      }
      // Box-Muller; 1 - next() keeps the log argument in (0, 1].
      const radius = Math.sqrt(-2 * Math.log(1 - next()));
      const angle = 2 * Math.PI * next();
      spareGaussian = radius * Math.sin(angle);
      return radius * Math.cos(angle) * sigma;
    },
    integer(maxExclusive) {
      return Math.floor(next() * maxExclusive);
    },
  };
}
