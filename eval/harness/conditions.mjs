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

// Recorded clips replay as captured: no synthetic noise or transform.
export const RECORDED = [
  { id: 'rec-static', group: 'recorded', productId: 1, file: 'static.mp4', warmupSeconds: 2, measureSeconds: 10 },
  { id: 'rec-blink', group: 'recorded', productId: 1, file: 'blink.mp4', warmupSeconds: 2, measureSeconds: 10 },
];
