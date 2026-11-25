// One test per statechart edge. Each test drives the machine to the edge's
// source state, fires the edge, and checks the target state and the edge's
// side effects. The last test reads every edge from the machine definition and
// fails if one has no test here.
import type { TelemetryEvent } from '@facefit/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnyStateNode, AnyTransitionDefinition } from 'xstate';
import { ApiError } from '../../services/apiClient';
import { flush, latest, PRODUCT, startTryOn } from '../../test/tryOnHarness';
import type { FaceStatus } from '../faceStatus';
import {
  MAX_PERCEPTION_RESTARTS,
  PERCEPTION_RESTART_DELAY_MS,
  tryOnMachine,
  type PhotoDetection,
  type TryOnEvent,
} from '../machine';

const short = (id: string) =>
  id
    .replace('tryOn.session.source.live.', 'live.')
    .replace('tryOn.session.source.', 'source.')
    .replace('tryOn.session.', 'session.')
    .replace('tryOn.', '');

const eventName = (type: string) => {
  if (type === '') return 'always';
  if (type.startsWith('xstate.done.actor')) return 'done';
  if (type.startsWith('xstate.error.actor')) return 'error';
  if (type.startsWith('xstate.after')) return 'after';
  return type;
};

const edgeKey = (t: AnyTransitionDefinition) =>
  `${short((t.source as AnyStateNode).id)} ${eventName(String(t.eventType))} -> ${
    t.target?.map((n: AnyStateNode) => short(n.id)).join(',') ?? 'self'
  }`;

/** Every edge in the machine definition. */
const definedEdges = (node: AnyStateNode): string[] => [
  ...[...node.transitions.values()].flat().map(edgeKey),
  ...(node.always ?? []).map(edgeKey),
  ...Object.values(node.states).flatMap((child) => definedEdges(child as AnyStateNode)),
];

const start = () => {
  const steps: string[] = [];
  return { ...startTryOn((t) => steps.push(edgeKey(t))), steps };
};

type Run = ReturnType<typeof start>;

const status = (faces: number, tracked: boolean, lowLight = false): FaceStatus => ({
  faces,
  tracked,
  lowLight,
});
const FACE_EVENTS = {
  multiple: { type: 'FACE_STATUS', status: status(2, true) },
  tracking: { type: 'FACE_STATUS', status: status(1, true) },
  lowLight: { type: 'FACE_STATUS', status: status(0, false, true) },
  none: { type: 'FACE_STATUS', status: status(0, false) },
} as const satisfies Record<string, TryOnEvent>;

// Routes to source states.
const session = async (run: Run) => {
  latest(run.loads).resolve(PRODUCT);
  await flush();
};
const running = async (run: Run) => {
  await session(run);
  run.send({ type: 'CAMERA_READY' });
  run.send({ type: 'MODEL_LOADED' });
  run.send({ type: 'PERCEPTION_READY' });
};
const faceState = (state: 'lowLight' | 'tracking' | 'multiple' | 'lost') => async (run: Run) => {
  await running(run);
  if (state === 'lost') {
    run.send(FACE_EVENTS.tracking);
    run.send(FACE_EVENTS.none);
  } else run.send(FACE_EVENTS[state]);
};
const sending =
  (...events: TryOnEvent[]) =>
  async (run: Run) => {
    await session(run);
    events.forEach(run.send);
  };
const photo =
  (...events: TryOnEvent[]) =>
  async (run: Run) => {
    await sending({ type: 'USE_PHOTO' }, ...events)(run);
  };
const photoResult = (detection: PhotoDetection | Error) => async (run: Run) => {
  await photo({ type: 'PHOTO_SELECTED', photo: new Blob(['a']) })(run);
  const pending = latest(run.detections);
  if (detection instanceof Error) pending.reject(detection);
  else pending.resolve(detection);
  await flush();
};

const live = (region: object) => ({ session: { source: { live: region } } });
const camera = (state: unknown) => live({ camera: state });
const perception = (state: unknown) => live({ perception: state });
const runningFace = (state: string) => perception({ active: { running: state } });
const overlay = (state: string) => ({ session: { overlay: state } });
const photoIn = (state: string) => ({ session: { source: { photo: state } } });

interface EdgeCase {
  edge: string;
  from: (run: Run) => Promise<void>;
  fire: (run: Run) => Promise<void> | void;
  to: object | string;
  check?: (run: Run) => void;
}

const fire =
  (event: TryOnEvent) =>
  (run: Run): void => {
    run.send(event);
  };

const reports = (event: TelemetryEvent) => (run: Run) => {
  expect(run.reported).toContainEqual(event);
};

const id = PRODUCT.id;

const EDGES: EdgeCase[] = [
  // Product.
  {
    edge: 'product.loading done -> session',
    from: async () => {},
    fire: session,
    to: { session: { overlay: 'loading' } },
    check: (run) => {
      expect(run.actor.getSnapshot().context.product).toEqual(PRODUCT);
      reports({ eventType: 'product_viewed', payload: { productId: id } })(run);
    },
  },
  {
    edge: 'product.loading error -> product.notFound',
    from: async () => {},
    fire: async (run) => {
      latest(run.loads).reject(new ApiError('not_found', 'Product not found', 404));
      await flush();
    },
    to: { product: 'notFound' },
    check: reports({
      eventType: 'product_load_failed',
      payload: { productId: id, errorCode: 'not_found' },
    }),
  },
  {
    edge: 'product.loading error -> product.unavailable',
    from: async () => {},
    fire: async (run) => {
      latest(run.loads).reject(new ApiError('network', 'offline'));
      await flush();
    },
    to: { product: 'unavailable' },
    check: reports({
      eventType: 'product_load_failed',
      payload: { productId: id, errorCode: 'network' },
    }),
  },
  {
    edge: 'product.unavailable RETRY_PRODUCT -> product.loading',
    from: async (run) => {
      latest(run.loads).reject(new ApiError('timeout', 'slow'));
      await flush();
    },
    fire: fire({ type: 'RETRY_PRODUCT' }),
    to: { product: 'loading' },
    check: (run) => {
      expect(run.loads).toHaveLength(2);
    },
  },

  // Overlay.
  {
    edge: 'session.overlay RENDER_CRASHED -> session.overlay.failed',
    from: sending({ type: 'MODEL_LOADED' }),
    fire: fire({ type: 'RENDER_CRASHED' }),
    to: overlay('failed'),
    check: reports({
      eventType: 'render_error',
      payload: { productId: id, errorCode: 'render_crash' },
    }),
  },
  {
    edge: 'session.overlay.loading MODEL_LOADED -> session.overlay.ready',
    from: session,
    fire: fire({ type: 'MODEL_LOADED' }),
    to: overlay('ready'),
  },
  {
    edge: 'session.overlay.loading MODEL_FAILED -> session.overlay.failed',
    from: session,
    fire: fire({ type: 'MODEL_FAILED' }),
    to: overlay('failed'),
    check: reports({
      eventType: 'render_error',
      payload: { productId: id, errorCode: 'model_load' },
    }),
  },
  {
    edge: 'session.overlay.loading WEBGL_UNAVAILABLE -> session.overlay.noWebgl',
    from: session,
    fire: fire({ type: 'WEBGL_UNAVAILABLE' }),
    to: overlay('noWebgl'),
    check: reports({
      eventType: 'render_error',
      payload: { productId: id, errorCode: 'webgl_unavailable' },
    }),
  },
  {
    edge: 'session.overlay.ready CONTEXT_LOST -> session.overlay.contextLost',
    from: sending({ type: 'MODEL_LOADED' }),
    fire: fire({ type: 'CONTEXT_LOST' }),
    to: overlay('contextLost'),
    check: reports({
      eventType: 'render_error',
      payload: { productId: id, errorCode: 'context_lost' },
    }),
  },
  {
    edge: 'session.overlay.contextLost.modelLoaded CONTEXT_RESTORED -> session.overlay.ready',
    from: sending({ type: 'MODEL_LOADED' }, { type: 'CONTEXT_LOST' }),
    fire: fire({ type: 'CONTEXT_RESTORED' }),
    to: overlay('ready'),
    check: (run) => {
      expect(run.actor.getSnapshot().context.overlayAttempt).toBe(0);
    },
  },
  {
    edge: 'session.overlay.loading CONTEXT_LOST -> session.overlay.contextLost.modelLoading',
    from: session,
    fire: fire({ type: 'CONTEXT_LOST' }),
    to: { session: { overlay: { contextLost: 'modelLoading' } } },
    check: reports({
      eventType: 'render_error',
      payload: { productId: id, errorCode: 'context_lost' },
    }),
  },
  {
    // The model loading while the context is gone does not hide the loss.
    edge: 'session.overlay.contextLost.modelLoading MODEL_LOADED -> session.overlay.contextLost.modelLoaded',
    from: sending({ type: 'CONTEXT_LOST' }),
    fire: fire({ type: 'MODEL_LOADED' }),
    to: { session: { overlay: { contextLost: 'modelLoaded' } } },
  },
  {
    edge: 'session.overlay.contextLost.modelLoading MODEL_FAILED -> session.overlay.failed',
    from: sending({ type: 'CONTEXT_LOST' }),
    fire: fire({ type: 'MODEL_FAILED' }),
    to: overlay('failed'),
    check: reports({
      eventType: 'render_error',
      payload: { productId: id, errorCode: 'model_load' },
    }),
  },
  {
    edge: 'session.overlay.contextLost.modelLoading CONTEXT_RESTORED -> session.overlay.loading',
    from: sending({ type: 'CONTEXT_LOST' }),
    fire: fire({ type: 'CONTEXT_RESTORED' }),
    to: overlay('loading'),
    check: (run) => {
      // The same scene is still loading its model, so nothing remounts.
      expect(run.actor.getSnapshot().context.overlayAttempt).toBe(0);
    },
  },
  ...(['contextLost', 'failed', 'noWebgl'] as const).map((state): EdgeCase => ({
    edge: `session.overlay.${state} RETRY_OVERLAY -> session.overlay.loading`,
    from: sending(
      ...(
        {
          contextLost: [{ type: 'MODEL_LOADED' }, { type: 'CONTEXT_LOST' }],
          failed: [{ type: 'MODEL_FAILED' }],
          noWebgl: [{ type: 'WEBGL_UNAVAILABLE' }],
        } satisfies Record<string, TryOnEvent[]>
      )[state],
    ),
    fire: fire({ type: 'RETRY_OVERLAY' }),
    to: overlay('loading'),
    check: (run) => {
      expect(run.actor.getSnapshot().context.overlayAttempt).toBe(1);
    },
  })),

  // Source.
  {
    edge: 'source.live USE_PHOTO -> source.photo',
    from: running,
    fire: fire({ type: 'USE_PHOTO' }),
    to: photoIn('choosing'),
  },
  {
    edge: 'source.photo USE_CAMERA -> source.live',
    from: photoResult({ faceFound: true }),
    fire: fire({ type: 'USE_CAMERA' }),
    to: camera({ active: 'requesting' }),
    check: (run) => {
      expect(run.actor.getSnapshot().context.photo).toBeNull();
    },
  },
  {
    edge: 'tryOn VIEW_CLOSED -> self',
    from: photoResult({ faceFound: true }),
    fire: fire({ type: 'VIEW_CLOSED' }),
    to: photoIn('showing'),
    check: (run) => {
      expect(run.actor.getSnapshot().context.photo).toBeNull();
    },
  },

  // Visibility.
  {
    edge: 'live.visibility.visible PAGE_HIDDEN -> pageHidden',
    from: session,
    fire: fire({ type: 'PAGE_HIDDEN' }),
    to: live({ visibility: 'hidden' }),
  },
  {
    edge: 'pageHidden PAGE_VISIBLE -> live.visibility.visible',
    from: sending({ type: 'PAGE_HIDDEN' }),
    fire: fire({ type: 'PAGE_VISIBLE' }),
    to: live({ visibility: 'visible' }),
  },

  // Camera.
  ...(
    [
      ['denied', 'denied', 'permission_denied'],
      ['missing', 'missing', 'camera_missing'],
      ['busy', 'busy', 'camera_busy'],
      ['unsupported', 'unsupported', 'unsupported'],
      ['unknown', 'failed', 'unknown'],
    ] as const
  ).map(([failure, state, errorCode]): EdgeCase => ({
    edge: `live.camera.active CAMERA_FAILED -> live.camera.${state}`,
    from: session,
    fire: fire({ type: 'CAMERA_FAILED', failure }),
    to: camera(state),
    check: reports({ eventType: 'camera_error', payload: { productId: id, errorCode } }),
  })),
  {
    edge: 'live.camera.active CAMERA_ENDED -> live.camera.ended',
    from: sending({ type: 'CAMERA_READY' }),
    fire: fire({ type: 'CAMERA_ENDED' }),
    to: camera('ended'),
    check: reports({
      eventType: 'camera_error',
      payload: { productId: id, errorCode: 'camera_ended' },
    }),
  },
  {
    edge: 'live.camera.active.requesting CAMERA_READY -> live.camera.active.streaming',
    from: session,
    fire: fire({ type: 'CAMERA_READY' }),
    to: camera({ active: 'streaming' }),
    check: reports({ eventType: 'camera_started', payload: { productId: id } }),
  },
  {
    edge: 'live.camera.active.streaming PAGE_HIDDEN -> live.camera.active.paused',
    from: sending({ type: 'CAMERA_READY' }),
    fire: fire({ type: 'PAGE_HIDDEN' }),
    to: camera({ active: 'paused' }),
    check: (run) => {
      expect(run.commands).toContain('camera PAUSE');
    },
  },
  {
    edge: 'live.camera.active.streaming always -> live.camera.active.paused',
    from: sending({ type: 'PAGE_HIDDEN' }),
    fire: fire({ type: 'CAMERA_READY' }),
    to: camera({ active: 'paused' }),
    check: (run) => {
      expect(run.commands).toEqual(['camera PAUSE']);
    },
  },
  {
    edge: 'live.camera.active.paused PAGE_VISIBLE -> live.camera.active.streaming',
    from: sending({ type: 'CAMERA_READY' }, { type: 'PAGE_HIDDEN' }),
    fire: fire({ type: 'PAGE_VISIBLE' }),
    to: camera({ active: 'streaming' }),
    check: (run) => {
      expect(run.commands).toEqual(['camera PAUSE', 'camera RESUME']);
    },
  },
  ...(
    [
      ['denied', { type: 'CAMERA_FAILED', failure: 'denied' }, 'RETRY_CAMERA'],
      ['missing', { type: 'CAMERA_FAILED', failure: 'missing' }, 'RETRY_CAMERA'],
      ['missing', { type: 'CAMERA_FAILED', failure: 'missing' }, 'DEVICE_CHANGE'],
      ['busy', { type: 'CAMERA_FAILED', failure: 'busy' }, 'RETRY_CAMERA'],
      ['failed', { type: 'CAMERA_FAILED', failure: 'unknown' }, 'RETRY_CAMERA'],
      ['ended', { type: 'CAMERA_ENDED' }, 'RETRY_CAMERA'],
      ['ended', { type: 'CAMERA_ENDED' }, 'DEVICE_CHANGE'],
      ['ended', { type: 'CAMERA_ENDED' }, 'PAGE_VISIBLE'],
    ] as const
  ).map(([state, failure, recovery]): EdgeCase => ({
    edge: `live.camera.${state} ${recovery} -> live.camera.active`,
    from: sending(failure),
    fire: fire({ type: recovery }),
    to: camera({ active: 'requesting' }),
  })),

  // Perception.
  {
    edge: 'live.perception.active PERCEPTION_FAILED -> live.perception.restarting',
    from: running,
    fire: fire({ type: 'PERCEPTION_FAILED', failure: 'crashed' }),
    to: perception('restarting'),
    check: (run) => {
      expect(run.actor.getSnapshot().context.perceptionRestarts).toBe(1);
      reports({
        eventType: 'tracking_error',
        payload: { productId: id, errorCode: 'worker_crash' },
      })(run);
    },
  },
  ...(
    [
      ['model_fetch', 'modelFetch', 'model_fetch'],
      ['wasm_fetch', 'wasmFetch', 'wasm_fetch'],
      ['unsupported', 'unsupported', 'unsupported'],
      ['capture_unsupported', 'captureUnsupported', 'capture_unsupported'],
    ] as const
  ).map(([failure, state, errorCode]): EdgeCase => ({
    edge: `live.perception.active PERCEPTION_FAILED -> live.perception.failed.${state}`,
    from: session,
    fire: fire({ type: 'PERCEPTION_FAILED', failure }),
    to: perception({ failed: state }),
    check: reports({ eventType: 'tracking_error', payload: { productId: id, errorCode } }),
  })),
  {
    edge: 'live.perception.active PERCEPTION_FAILED -> live.perception.failed.crashed',
    from: async (run) => {
      vi.useFakeTimers();
      await running(run);
      for (let i = 0; i < MAX_PERCEPTION_RESTARTS; i += 1) {
        run.send({ type: 'PERCEPTION_FAILED', failure: 'crashed' });
        vi.advanceTimersByTime(PERCEPTION_RESTART_DELAY_MS);
      }
    },
    fire: fire({ type: 'PERCEPTION_FAILED', failure: 'crashed' }),
    to: perception({ failed: 'crashed' }),
    check: (run) => {
      expect(run.actor.getSnapshot().context.perceptionRestarts).toBe(MAX_PERCEPTION_RESTARTS);
    },
  },
  {
    edge: 'live.perception.active.loading PERCEPTION_READY -> live.perception.active.running',
    from: session,
    fire: fire({ type: 'PERCEPTION_READY' }),
    to: runningFace('searching'),
  },
  {
    edge: 'live.perception.active.running PAGE_HIDDEN -> live.perception.active.paused',
    from: running,
    fire: fire({ type: 'PAGE_HIDDEN' }),
    to: perception({ active: 'paused' }),
    check: (run) => {
      expect(run.commands).toContain('perception PAUSE');
    },
  },
  {
    edge: 'live.perception.active.running always -> live.perception.active.paused',
    from: sending({ type: 'PAGE_HIDDEN' }),
    fire: fire({ type: 'PERCEPTION_READY' }),
    to: perception({ active: 'paused' }),
    check: (run) => {
      expect(run.commands).toEqual(['perception PAUSE']);
    },
  },
  {
    edge: 'live.perception.active.paused PAGE_VISIBLE -> live.perception.active.running',
    from: async (run) => {
      await running(run);
      run.send({ type: 'PAGE_HIDDEN' });
    },
    fire: fire({ type: 'PAGE_VISIBLE' }),
    to: runningFace('searching'),
    check: (run) => {
      expect(run.commands).toContain('perception RESUME');
    },
  },
  {
    edge: 'live.perception.restarting after -> live.perception.active',
    from: async (run) => {
      vi.useFakeTimers();
      await running(run);
      run.send({ type: 'PERCEPTION_FAILED', failure: 'crashed' });
    },
    fire: () => {
      vi.advanceTimersByTime(PERCEPTION_RESTART_DELAY_MS);
    },
    to: perception({ active: 'loading' }),
  },
  {
    edge: 'live.perception.failed RETRY_PERCEPTION -> live.perception.active',
    from: sending({ type: 'PERCEPTION_FAILED', failure: 'model_fetch' }),
    fire: fire({ type: 'RETRY_PERCEPTION' }),
    to: perception({ active: 'loading' }),
    check: (run) => {
      expect(run.actor.getSnapshot().context.perceptionRestarts).toBe(0);
    },
  },

  // Face.
  ...(
    [
      ['searching', running, 'multiple', 'multiple'],
      ['searching', running, 'tracking', 'tracking'],
      ['searching', running, 'lowLight', 'lowLight'],
      ['lowLight', faceState('lowLight'), 'multiple', 'multiple'],
      ['lowLight', faceState('lowLight'), 'tracking', 'tracking'],
      ['lowLight', faceState('lowLight'), 'none', 'searching'],
      ['tracking', faceState('tracking'), 'multiple', 'multiple'],
      ['tracking', faceState('tracking'), 'lowLight', 'lowLight'],
      ['tracking', faceState('tracking'), 'none', 'lost'],
      ['multiple', faceState('multiple'), 'tracking', 'tracking'],
      ['multiple', faceState('multiple'), 'lowLight', 'lowLight'],
      ['multiple', faceState('multiple'), 'none', 'lost'],
      ['lost', faceState('lost'), 'multiple', 'multiple'],
      ['lost', faceState('lost'), 'tracking', 'tracking'],
      ['lost', faceState('lost'), 'lowLight', 'lowLight'],
    ] as const
  ).map(([source, from, face, target]): EdgeCase => ({
    edge: `live.perception.active.running.${source} FACE_STATUS -> live.perception.active.running.${target}`,
    from,
    fire: fire(FACE_EVENTS[face]),
    to: runningFace(target),
    check: (run) => {
      const faceDetected = { tracking: true, lost: false }[target as string];
      if (faceDetected !== undefined) {
        expect(run.reported.at(-1)).toEqual({
          eventType: 'tracking_state_changed',
          payload: { productId: id, faceDetected },
        });
      }
    },
  })),

  // Photo.
  {
    edge: 'source.photo.choosing PHOTO_SELECTED -> source.photo.detecting',
    from: photo(),
    fire: fire({ type: 'PHOTO_SELECTED', photo: new Blob(['a']) }),
    to: photoIn('detecting'),
    check: (run) => {
      expect(run.detections).toHaveLength(1);
      expect(run.actor.getSnapshot().context.photo?.size).toBe(1);
    },
  },
  {
    edge: 'source.photo.detecting done -> source.photo.showing',
    from: photo({ type: 'PHOTO_SELECTED', photo: new Blob(['a']) }),
    fire: async (run) => {
      latest(run.detections).resolve({ faceFound: true });
      await flush();
    },
    to: photoIn('showing'),
  },
  {
    edge: 'source.photo.detecting done -> source.photo.noFace',
    from: photo({ type: 'PHOTO_SELECTED', photo: new Blob(['a']) }),
    fire: async (run) => {
      latest(run.detections).resolve({ faceFound: false });
      await flush();
    },
    to: photoIn('noFace'),
  },
  {
    edge: 'source.photo.detecting error -> source.photo.failed',
    from: photo({ type: 'PHOTO_SELECTED', photo: new Blob(['a']) }),
    fire: async (run) => {
      latest(run.detections).reject(new Error('decode failed'));
      await flush();
    },
    to: photoIn('failed'),
  },
  ...(
    [
      ['showing', { faceFound: true }],
      ['noFace', { faceFound: false }],
      ['failed', new Error('decode failed')],
    ] as const
  ).map(([state, outcome]): EdgeCase => ({
    edge: `source.photo.${state} PHOTO_SELECTED -> source.photo.detecting`,
    from: photoResult(outcome),
    fire: fire({ type: 'PHOTO_SELECTED', photo: new Blob(['bb']) }),
    to: photoIn('detecting'),
    check: (run) => {
      expect(run.actor.getSnapshot().context.photo?.size).toBe(2);
    },
  })),
  {
    edge: 'source.photo.failed RETRY_PHOTO -> source.photo.detecting',
    from: photoResult(new Error('decode failed')),
    fire: fire({ type: 'RETRY_PHOTO' }),
    to: photoIn('detecting'),
    check: (run) => {
      expect(run.detections).toHaveLength(2);
    },
  },
];

const covered = new Set<string>();

describe('try-on statechart edges', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(EDGES)('$edge', async ({ edge, from, fire: act, to, check }) => {
    const run = start();
    await from(run);
    run.steps.length = 0;
    await act(run);
    expect(run.steps).toContain(edge);
    expect(run.actor.getSnapshot().matches(to as never)).toBe(true);
    check?.(run);
    covered.add(edge);
    run.actor.stop();
  });
});

describe('try-on statechart coverage', () => {
  it('has exactly one test per edge, and every test passed', () => {
    const defined = definedEdges(tryOnMachine.root);
    expect(new Set(defined).size).toBe(defined.length);
    expect(EDGES.map((test) => test.edge).sort()).toEqual([...defined].sort());
    expect([...covered].sort()).toEqual([...defined].sort());
  });
});
