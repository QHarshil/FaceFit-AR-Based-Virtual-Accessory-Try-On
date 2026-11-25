import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../services/apiClient';
import { flush, latest, PRODUCT, startTryOn, type TryOnRun } from '../../test/tryOnHarness';
import { MAX_PERCEPTION_RESTARTS, PERCEPTION_RESTART_DELAY_MS, type TryOnEvent } from '../machine';
import { sourceOf, statusOf, TRY_ON_STATUSES, withPose, type TryOnStatus } from '../status';

const face = (faces: number, tracked: boolean, lowLight = false): TryOnEvent => ({
  type: 'FACE_STATUS',
  status: { faces, tracked, lowLight },
});
const LIVE: TryOnEvent[] = [
  { type: 'CAMERA_READY' },
  { type: 'PERCEPTION_READY' },
  { type: 'MODEL_LOADED' },
];
const PHOTO: TryOnEvent[] = [{ type: 'USE_PHOTO' }, { type: 'PHOTO_SELECTED', photo: new Blob() }];

type Route = (run: TryOnRun) => Promise<void>;

const product =
  (outcome: 'loaded' | ApiError | null): Route =>
  async (run) => {
    if (outcome === null) return;
    const load = latest(run.loads);
    if (outcome === 'loaded') load.resolve(PRODUCT);
    else load.reject(outcome);
    await flush();
  };

const after =
  (...events: TryOnEvent[]): Route =>
  async (run) => {
    await product('loaded')(run);
    events.forEach(run.send);
  };

const photoOutcome =
  (outcome: { faceFound: boolean } | Error, ...events: TryOnEvent[]): Route =>
  async (run) => {
    await after(...PHOTO)(run);
    const detection = latest(run.detections);
    if (outcome instanceof Error) detection.reject(outcome);
    else detection.resolve(outcome);
    await flush();
    events.forEach(run.send);
  };

// A Record over every status, so a new status does not compile without a route.
const ROUTES: Record<Exclude<TryOnStatus, 'faceTurned'>, Route> = {
  productLoading: product(null),
  productNotFound: product(new ApiError('not_found', 'gone', 404)),
  productUnavailable: product(new ApiError('network', 'offline')),
  cameraRequesting: after(),
  cameraDenied: after({ type: 'CAMERA_FAILED', failure: 'denied' }),
  cameraMissing: after({ type: 'CAMERA_FAILED', failure: 'missing' }),
  cameraBusy: after({ type: 'CAMERA_FAILED', failure: 'busy' }),
  cameraUnsupported: after({ type: 'CAMERA_FAILED', failure: 'unsupported' }),
  cameraFailed: after({ type: 'CAMERA_FAILED', failure: 'unknown' }),
  cameraEnded: after({ type: 'CAMERA_READY' }, { type: 'CAMERA_ENDED' }),
  modelLoading: after({ type: 'CAMERA_READY' }),
  trackingRestarting: after(...LIVE, { type: 'PERCEPTION_FAILED', failure: 'crashed' }),
  modelFetchFailed: after({ type: 'PERCEPTION_FAILED', failure: 'model_fetch' }),
  wasmFetchFailed: after({ type: 'PERCEPTION_FAILED', failure: 'wasm_fetch' }),
  trackingUnsupported: after({ type: 'PERCEPTION_FAILED', failure: 'unsupported' }),
  captureUnsupported: after({ type: 'PERCEPTION_FAILED', failure: 'capture_unsupported' }),
  trackingCrashed: async (run) => {
    await after(...LIVE)(run);
    vi.useFakeTimers();
    for (let i = 0; i < MAX_PERCEPTION_RESTARTS; i += 1) {
      run.send({ type: 'PERCEPTION_FAILED', failure: 'crashed' });
      vi.advanceTimersByTime(PERCEPTION_RESTART_DELAY_MS);
    }
    vi.useRealTimers();
    run.send({ type: 'PERCEPTION_FAILED', failure: 'crashed' });
  },
  glassesLoading: after({ type: 'CAMERA_READY' }, { type: 'PERCEPTION_READY' }),
  glassesFailed: after({ type: 'MODEL_FAILED' }),
  webglUnavailable: after({ type: 'WEBGL_UNAVAILABLE' }),
  contextLost: after(...LIVE, { type: 'CONTEXT_LOST' }),
  paused: after(...LIVE, { type: 'PAGE_HIDDEN' }),
  searching: after(...LIVE),
  lowLight: after(...LIVE, face(0, false, true)),
  multipleFaces: after(...LIVE, face(2, true)),
  faceLost: after(...LIVE, face(1, true), face(0, false)),
  tracking: after(...LIVE, face(1, true)),
  photoChoosing: after({ type: 'USE_PHOTO' }),
  photoDetecting: after(...PHOTO),
  photoShowing: photoOutcome({ faceFound: true }, { type: 'MODEL_LOADED' }),
  photoNoFace: photoOutcome({ faceFound: false }),
  photoFailed: photoOutcome(new Error('decode failed')),
};

describe('statusOf', () => {
  it.each(Object.entries(ROUTES))('reaches %s', async (expected, route) => {
    const run = startTryOn();
    await route(run);
    expect(statusOf(run.actor.getSnapshot())).toBe(expected);
    run.actor.stop();
  });

  it('routes every status but the pose refinement', () => {
    expect(Object.keys(ROUTES).sort()).toEqual(
      TRY_ON_STATUSES.filter((status) => status !== 'faceTurned').sort(),
    );
  });

  it('shows a lost WebGL context over tracking', async () => {
    const run = startTryOn();
    await after(...LIVE, face(1, true), { type: 'CONTEXT_LOST' })(run);
    expect(statusOf(run.actor.getSnapshot())).toBe('contextLost');
    run.send({ type: 'CONTEXT_RESTORED' });
    expect(statusOf(run.actor.getSnapshot())).toBe('tracking');
  });

  it('asks for the camera before the model finishes loading', async () => {
    const run = startTryOn();
    await after()(run);
    expect(statusOf(run.actor.getSnapshot())).toBe('cameraRequesting');
  });

  it('shows the photo loading the 3D frame while the overlay loads', async () => {
    const run = startTryOn();
    await photoOutcome({ faceFound: true })(run);
    expect(statusOf(run.actor.getSnapshot())).toBe('glassesLoading');
  });

  it('reports the source', async () => {
    const run = startTryOn();
    expect(sourceOf(run.actor.getSnapshot())).toBeNull();
    await after()(run);
    expect(sourceOf(run.actor.getSnapshot())).toBe('live');
    run.send({ type: 'USE_PHOTO' });
    expect(sourceOf(run.actor.getSnapshot())).toBe('photo');
  });
});

describe('withPose', () => {
  it('asks the user to face the camera when the gate hides a tracked face', () => {
    expect(withPose('tracking', false)).toBe('faceTurned');
    expect(withPose('tracking', true)).toBe('tracking');
    expect(withPose('searching', false)).toBe('searching');
  });
});
