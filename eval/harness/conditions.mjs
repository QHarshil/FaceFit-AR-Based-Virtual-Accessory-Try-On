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

// Ramps at 240, 60 and 30 px/s and rolls peaking at 31 and 4.7 deg/s: a
// filter whose cutoff rises with speed trails slow motion most, so lag is
// measured at each speed.
export const MOTION = [
  { ...motionBase, id: 'step-x', motion: { kind: 'step', axis: 'dx', amplitude: 80, halfPeriodFrames: 30 } },
  { ...motionBase, id: 'ramp-x', motion: { kind: 'triangle', axis: 'dx', amplitude: 120, halfPeriodFrames: 30 } },
  { ...motionBase, id: 'ramp-x-60', motion: { kind: 'triangle', axis: 'dx', amplitude: 60, halfPeriodFrames: 60 } },
  { ...motionBase, id: 'ramp-x-30', motion: { kind: 'triangle', axis: 'dx', amplitude: 30, halfPeriodFrames: 60 } },
  { ...motionBase, id: 'sine-roll', motion: { kind: 'sine', axis: 'roll', amplitude: 10, periodFrames: 60 } },
  { ...motionBase, id: 'sine-roll-slow', motion: { kind: 'sine', axis: 'roll', amplitude: 3, periodFrames: 120 } },
];

// Two copies of the public-domain stand-in portrait side by side, built with
// `--source standin` only, so no recorded face is used. The user in the left
// half, at 0.6 of the face size in the stand-in's still clip, rolls 10 deg
// with a 2 s period and moves between -60 and +60 px with a 4 s period, while
// a bystander at 0.8 of the user's size stays still in the right half.
export const TWO_FACE = [
  {
    id: 'two-face', group: 'twoFace', productId: 1, clipSeconds: 4, warmupSeconds: 2, measureSeconds: 8,
    userScale: 0.6, bystanderScale: 0.8,
    roll: { kind: 'sine', amplitude: 10, periodFrames: 60 },
    shift: { kind: 'triangle', amplitude: 60, halfPeriodFrames: 60 },
  },
];

// Face speed of a ramp in px/s, or the peak angular speed of a roll in deg/s.
export const motionSpeed = (motion, fps = FRAME.fps) => {
  if (motion.kind === 'triangle') return ((2 * motion.amplitude) / motion.halfPeriodFrames) * fps;
  if (motion.kind === 'sine') return ((2 * Math.PI * motion.amplitude) / motion.periodFrames) * fps;
  return null;
};

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
