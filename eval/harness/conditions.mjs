// Replay conditions. Sweep clips are built from one still frame, so each has a
// known in-plane roll (degrees, clockwise on screen), translation of the face
// in output pixels, or zoom.
export const FRAME = { width: 1280, height: 720, fps: 30 };

const base = { productId: 1, roll: 0, dx: 0, dy: 0, zoom: 1, clipSeconds: 1, warmupSeconds: 2, measureSeconds: 3 };

export const CONDITIONS = [
  { ...base, id: 'still', group: 'still', clipSeconds: 10, warmupSeconds: 3, measureSeconds: 10 },
  ...[-15, -10, -5, 5, 10, 15].map((roll) => ({ ...base, id: `roll${roll}`, group: 'roll', roll })),
  ...[-320, -160, 160, 320].map((dx) => ({ ...base, id: `dx${dx}`, group: 'translate', dx })),
  ...[-120, 120].map((dy) => ({ ...base, id: `dy${dy}`, group: 'translate', dy })),
  ...[0.75, 1.33].map((zoom) => ({ ...base, id: `zoom${zoom}`, group: 'zoom', zoom })),
];

// Remaining catalog models on the still clip, for per-model fit.
export const PRODUCTS = [2, 3, 4].map((productId) => ({ ...base, id: `product${productId}`, group: 'product', clip: 'still', productId }));

// The same models on the zoom clips, so scale is checked for every model.
export const PRODUCT_ZOOMS = [2, 3, 4].flatMap((productId) => [0.75, 1.33].map((zoom) => ({ ...base, id: `product${productId}-zoom${zoom}`, group: 'productZoom', clip: `zoom${zoom}`, productId, zoom })));

// Recorded clips replay as captured: no synthetic noise or transform.
export const RECORDED = [
  { id: 'rec-static', group: 'recorded', productId: 1, file: 'static.mp4', warmupSeconds: 2, measureSeconds: 10 },
  { id: 'rec-blink', group: 'recorded', productId: 1, file: 'blink.mp4', warmupSeconds: 2, measureSeconds: 10 },
];

// Motion clips: the still frame moved by a known amount in every clip frame.
// Each period divides the clip length, so the loop has no jump. Chrome's fake
// camera timestamps a frame with timer jitter, so mediaTime alone can be one
// frame off; a binary code in the top-left corner names the clip frame.
export const FRAME_CODE = { bits: 8, blockPx: 16 };

const motionBase = { ...base, group: 'motion', clipSeconds: 4, warmupSeconds: 2, measureSeconds: 8 };

export const MOTION = [
  { ...motionBase, id: 'step-x', motion: { kind: 'step', axis: 'dx', amplitude: 80, halfPeriodFrames: 30 } },
  { ...motionBase, id: 'ramp-x', motion: { kind: 'triangle', axis: 'dx', amplitude: 120, halfPeriodFrames: 30 } },
  { ...motionBase, id: 'sine-roll', motion: { kind: 'sine', axis: 'roll', amplitude: 10, periodFrames: 60 } },
];

export const motionPeriodFrames = (motion) => motion.periodFrames ?? 2 * motion.halfPeriodFrames;

// The face's displacement in clip frame n: output pixels for dx (a step of
// +amplitude, or a triangle between -amplitude and +amplitude), degrees
// clockwise for roll.
export const motionTruth = (motion, n) => {
  const { kind, amplitude } = motion;
  if (kind === 'step') return amplitude * (Math.floor(n / motion.halfPeriodFrames) % 2);
  if (kind === 'triangle') {
    const h = motion.halfPeriodFrames;
    return -amplitude + ((2 * amplitude) / h) * (h - Math.abs(h - (n % (2 * h))));
  }
  if (kind === 'sine') return amplitude * Math.sin((2 * Math.PI * n) / motion.periodFrames);
  throw new Error(`unknown motion ${kind}`);
};

// motionTruth as an ffmpeg expression in the input frame number n.
export const motionExpression = (motion) => {
  const { kind, amplitude } = motion;
  if (kind === 'step') return `${amplitude}*mod(floor(n/${motion.halfPeriodFrames}),2)`;
  if (kind === 'triangle') {
    const h = motion.halfPeriodFrames;
    return `-${amplitude}+${(2 * amplitude) / h}*(${h}-abs(${h}-mod(n,${2 * h})))`;
  }
  if (kind === 'sine') return `${amplitude}*sin(2*PI*n/${motion.periodFrames})`;
  throw new Error(`unknown motion ${kind}`);
};
