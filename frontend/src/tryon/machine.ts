// The try-on statechart. It owns every asynchronous part of the page: the
// product request, the camera, the landmark worker, the overlay's WebGL scene
// and the photo fallback. Actors start and stop with the states that invoke
// them, so a callback from a camera or worker that has been replaced is never
// delivered. See README.md in this folder for the state list.
import type { Product, TelemetryEvent } from '@facefit/contracts';
import { assign, fromCallback, fromPromise, sendTo, setup, stateIn } from 'xstate';
import { apiFailureOf } from '../services/apiClient';
import { sendTelemetry } from '../telemetry/client';
import { telemetryEvents } from '../telemetry/events';
import type { CameraFailure, PerceptionFailure } from '../tracking/failures';
import { faceStateOf, type FaceState, type FaceStatus } from './faceStatus';

/** Restarts of a crashed worker before the try-on stops and asks the user. */
export const MAX_PERCEPTION_RESTARTS = 2;
export const PERCEPTION_RESTART_DELAY_MS = 1_000;

export interface TryOnInput {
  /** The route's product id, null when it is not a valid id. */
  productId: number | null;
}

export interface TryOnContext {
  productId: number | null;
  product: Product | null;
  perceptionRestarts: number;
  /** Increments on each overlay retry; the view remounts the overlay when it changes. */
  overlayAttempt: number;
  photo: Blob | null;
}

export interface PhotoDetection {
  faceFound: boolean;
}

export type TryOnEvent =
  | { type: 'RETRY_PRODUCT' }
  | { type: 'CAMERA_READY' }
  | { type: 'CAMERA_FAILED'; failure: CameraFailure }
  | { type: 'CAMERA_ENDED' }
  | { type: 'DEVICE_CHANGE' }
  | { type: 'RETRY_CAMERA' }
  | { type: 'PERCEPTION_READY' }
  | { type: 'PERCEPTION_FAILED'; failure: PerceptionFailure }
  | { type: 'RETRY_PERCEPTION' }
  | { type: 'FACE_STATUS'; status: FaceStatus }
  | { type: 'PAGE_HIDDEN' }
  | { type: 'PAGE_VISIBLE' }
  | { type: 'MODEL_LOADED' }
  | { type: 'MODEL_FAILED' }
  | { type: 'WEBGL_UNAVAILABLE' }
  | { type: 'CONTEXT_LOST' }
  | { type: 'CONTEXT_RESTORED' }
  | { type: 'RENDER_CRASHED' }
  | { type: 'RETRY_OVERLAY' }
  | { type: 'USE_PHOTO' }
  | { type: 'USE_CAMERA' }
  | { type: 'PHOTO_SELECTED'; photo: Blob }
  | { type: 'RETRY_PHOTO' }
  | { type: 'VIEW_CLOSED' };

/** Commands the camera and perception actors receive while the page is hidden and shown. */
export type PauseCommand = { type: 'PAUSE' } | { type: 'RESUME' };

// Inert stand-ins. The page provides the real actors (actors.ts) with
// `machine.provide`, and the transition tests drive the machine with events.
const pending = <T>() => new Promise<T>(() => {});
const idle = () => () => {};

const tryOnSetup = setup({
  types: {
    context: {} as TryOnContext,
    events: {} as TryOnEvent,
    input: {} as TryOnInput,
  },
  actors: {
    loadProduct: fromPromise<Product, { productId: number | null }>(() => pending()),
    camera: fromCallback<PauseCommand>(idle),
    perception: fromCallback<PauseCommand>(idle),
    pageVisibility: fromCallback(idle),
    deviceWatcher: fromCallback(idle),
    detectPhoto: fromPromise<PhotoDetection, { photo: Blob | null }>(() => pending()),
  },
  actions: {
    report: (_, event: TelemetryEvent) => {
      sendTelemetry(event);
    },
  },
  guards: {
    cameraFailed: ({ event }, params: { failure: CameraFailure }) =>
      event.type === 'CAMERA_FAILED' && event.failure === params.failure,
    perceptionFailed: ({ event }, params: { failure: PerceptionFailure }) =>
      event.type === 'PERCEPTION_FAILED' && event.failure === params.failure,
    canRestartPerception: ({ context, event }) =>
      event.type === 'PERCEPTION_FAILED' &&
      event.failure === 'crashed' &&
      context.perceptionRestarts < MAX_PERCEPTION_RESTARTS,
    faceIs: ({ event }, params: { state: FaceState }) =>
      event.type === 'FACE_STATUS' && faceStateOf(event.status) === params.state,
    pageHidden: stateIn('#pageHidden'),
  },
  delays: {
    perceptionRestart: PERCEPTION_RESTART_DELAY_MS,
  },
});

const report = (build: (context: TryOnContext) => TelemetryEvent) => ({
  type: 'report' as const,
  params: ({ context }: { context: TryOnContext }) => build(context),
});

const contextLost = (target: string) => ({
  target,
  actions: report((context) => telemetryEvents.renderError(context.productId, 'context_lost')),
});

const retryOverlay = {
  target: 'loading',
  actions: tryOnSetup.assign({ overlayAttempt: ({ context }) => context.overlayAttempt + 1 }),
};

const choosePhoto = {
  target: 'detecting',
  actions: tryOnSetup.assign({
    photo: ({ event }) => (event.type === 'PHOTO_SELECTED' ? event.photo : null),
  }),
};

// A camera failure leaves the active state for a sibling that offers the recovery.
const cameraFailure = (cause: CameraFailure, target: string) => ({
  guard: { type: 'cameraFailed' as const, params: { failure: cause } },
  target,
  actions: report((context) => telemetryEvents.cameraError(context.productId, cause)),
});

const perceptionFailure = (cause: PerceptionFailure, target: string) => ({
  guard: { type: 'perceptionFailed' as const, params: { failure: cause } },
  target: `failed.${target}`,
  actions: report((context) => telemetryEvents.trackingError(context.productId, cause)),
});

const face = (state: FaceState, target: string) => ({
  guard: { type: 'faceIs' as const, params: { state } },
  target,
});

export const tryOnMachine = tryOnSetup.createMachine({
  id: 'tryOn',
  context: ({ input }) => ({
    productId: input.productId,
    product: null,
    perceptionRestarts: 0,
    overlayAttempt: 0,
    photo: null,
  }),
  initial: 'product',
  // Sent by the view as it unmounts. A stopped actor keeps its last
  // snapshot and XState runs no exit actions on stop, so the photo is
  // dropped here.
  on: { VIEW_CLOSED: { actions: assign({ photo: null }) } },
  states: {
    product: {
      initial: 'loading',
      states: {
        loading: {
          invoke: {
            src: 'loadProduct',
            input: ({ context }) => ({ productId: context.productId }),
            onDone: {
              target: '#tryOn.session',
              actions: [
                assign({ product: ({ event }) => event.output }),
                {
                  type: 'report',
                  params: ({ event }) => telemetryEvents.productViewed(event.output.id),
                },
              ],
            },
            onError: [
              {
                guard: ({ event }) => apiFailureOf(event.error) === 'not_found',
                target: 'notFound',
                actions: report((context) =>
                  telemetryEvents.productLoadFailed(context.productId, 'not_found'),
                ),
              },
              {
                target: 'unavailable',
                actions: {
                  type: 'report',
                  params: ({ context, event }) =>
                    telemetryEvents.productLoadFailed(context.productId, apiFailureOf(event.error)),
                },
              },
            ],
          },
        },
        notFound: {},
        unavailable: { on: { RETRY_PRODUCT: 'loading' } },
      },
    },

    session: {
      type: 'parallel',
      states: {
        overlay: {
          initial: 'loading',
          on: {
            RENDER_CRASHED: {
              target: '.failed',
              actions: report((context) =>
                telemetryEvents.renderError(context.productId, 'render_crash'),
              ),
            },
          },
          states: {
            loading: {
              on: {
                MODEL_LOADED: 'ready',
                MODEL_FAILED: {
                  target: 'failed',
                  actions: report((context) =>
                    telemetryEvents.renderError(context.productId, 'model_load'),
                  ),
                },
                WEBGL_UNAVAILABLE: {
                  target: 'noWebgl',
                  actions: report((context) =>
                    telemetryEvents.renderError(context.productId, 'webgl_unavailable'),
                  ),
                },
                CONTEXT_LOST: contextLost('contextLost.modelLoading'),
              },
            },
            ready: { on: { CONTEXT_LOST: contextLost('contextLost') } },
            // The GLB keeps loading while the context is gone, so the
            // substate remembers whether a restore returns to ready or to
            // loading.
            contextLost: {
              on: { RETRY_OVERLAY: retryOverlay },
              initial: 'modelLoaded',
              states: {
                modelLoaded: { on: { CONTEXT_RESTORED: '#tryOn.session.overlay.ready' } },
                modelLoading: {
                  on: {
                    MODEL_LOADED: 'modelLoaded',
                    MODEL_FAILED: {
                      target: '#tryOn.session.overlay.failed',
                      actions: report((context) =>
                        telemetryEvents.renderError(context.productId, 'model_load'),
                      ),
                    },
                    CONTEXT_RESTORED: '#tryOn.session.overlay.loading',
                  },
                },
              },
            },
            failed: { on: { RETRY_OVERLAY: retryOverlay } },
            noWebgl: { on: { RETRY_OVERLAY: retryOverlay } },
          },
        },

        source: {
          initial: 'live',
          states: {
            live: {
              type: 'parallel',
              invoke: { src: 'pageVisibility' },
              on: { USE_PHOTO: '#tryOn.session.source.photo' },
              states: {
                visibility: {
                  initial: 'visible',
                  states: {
                    visible: { on: { PAGE_HIDDEN: 'hidden' } },
                    hidden: { id: 'pageHidden', on: { PAGE_VISIBLE: 'visible' } },
                  },
                },

                camera: {
                  initial: 'active',
                  states: {
                    active: {
                      invoke: { src: 'camera', id: 'camera' },
                      initial: 'requesting',
                      on: {
                        CAMERA_FAILED: [
                          cameraFailure('denied', 'denied'),
                          cameraFailure('missing', 'missing'),
                          cameraFailure('busy', 'busy'),
                          cameraFailure('unsupported', 'unsupported'),
                          cameraFailure('unknown', 'failed'),
                        ],
                        CAMERA_ENDED: {
                          target: 'ended',
                          actions: report((context) =>
                            telemetryEvents.cameraError(context.productId, 'ended'),
                          ),
                        },
                      },
                      states: {
                        requesting: {
                          on: {
                            CAMERA_READY: {
                              target: 'streaming',
                              actions: report((context) =>
                                telemetryEvents.cameraStarted(context.productId),
                              ),
                            },
                          },
                        },
                        streaming: {
                          always: { guard: 'pageHidden', target: 'paused' },
                          on: { PAGE_HIDDEN: 'paused' },
                        },
                        // The camera is released while hidden and asked
                        // for again when shown, so the page waits for it.
                        paused: {
                          entry: sendTo('camera', { type: 'PAUSE' }),
                          on: {
                            PAGE_VISIBLE: {
                              target: 'requesting',
                              actions: sendTo('camera', { type: 'RESUME' }),
                            },
                          },
                        },
                      },
                    },
                    denied: { on: { RETRY_CAMERA: 'active' } },
                    missing: {
                      invoke: { src: 'deviceWatcher' },
                      on: { RETRY_CAMERA: 'active', DEVICE_CHANGE: 'active' },
                    },
                    busy: { on: { RETRY_CAMERA: 'active' } },
                    unsupported: {},
                    failed: { on: { RETRY_CAMERA: 'active' } },
                    // The track ended: unplugged, taken by another app, or
                    // stopped by the OS while the page was in the background.
                    ended: {
                      invoke: { src: 'deviceWatcher' },
                      on: {
                        RETRY_CAMERA: 'active',
                        DEVICE_CHANGE: 'active',
                        PAGE_VISIBLE: 'active',
                      },
                    },
                  },
                },

                perception: {
                  initial: 'active',
                  states: {
                    active: {
                      invoke: { src: 'perception', id: 'perception' },
                      initial: 'loading',
                      on: {
                        PERCEPTION_FAILED: [
                          {
                            guard: 'canRestartPerception',
                            target: 'restarting',
                            actions: [
                              tryOnSetup.assign({
                                perceptionRestarts: ({ context }) => context.perceptionRestarts + 1,
                              }),
                              report((context) =>
                                telemetryEvents.trackingError(context.productId, 'crashed'),
                              ),
                            ],
                          },
                          perceptionFailure('model_fetch', 'modelFetch'),
                          perceptionFailure('wasm_fetch', 'wasmFetch'),
                          perceptionFailure('unsupported', 'unsupported'),
                          perceptionFailure('capture_unsupported', 'captureUnsupported'),
                          perceptionFailure('crashed', 'crashed'),
                        ],
                      },
                      states: {
                        loading: { on: { PERCEPTION_READY: 'running' } },
                        running: {
                          always: { guard: 'pageHidden', target: 'paused' },
                          on: { PAGE_HIDDEN: 'paused' },
                          initial: 'searching',
                          states: {
                            searching: {
                              on: {
                                FACE_STATUS: [
                                  face('multiple', 'multiple'),
                                  face('tracking', 'tracking'),
                                  face('lowLight', 'lowLight'),
                                ],
                              },
                            },
                            lowLight: {
                              on: {
                                FACE_STATUS: [
                                  face('multiple', 'multiple'),
                                  face('tracking', 'tracking'),
                                  face('none', 'searching'),
                                ],
                              },
                            },
                            tracking: {
                              entry: report((context) =>
                                telemetryEvents.faceDetectedChanged(context.productId, true),
                              ),
                              on: {
                                FACE_STATUS: [
                                  face('multiple', 'multiple'),
                                  face('lowLight', 'lowLight'),
                                  face('none', 'lost'),
                                ],
                              },
                            },
                            multiple: {
                              on: {
                                FACE_STATUS: [
                                  face('tracking', 'tracking'),
                                  face('lowLight', 'lowLight'),
                                  face('none', 'lost'),
                                ],
                              },
                            },
                            lost: {
                              entry: report((context) =>
                                telemetryEvents.faceDetectedChanged(context.productId, false),
                              ),
                              on: {
                                FACE_STATUS: [
                                  face('multiple', 'multiple'),
                                  face('tracking', 'tracking'),
                                  face('lowLight', 'lowLight'),
                                ],
                              },
                            },
                          },
                        },
                        paused: {
                          entry: sendTo('perception', { type: 'PAUSE' }),
                          on: {
                            PAGE_VISIBLE: {
                              target: 'running',
                              actions: sendTo('perception', { type: 'RESUME' }),
                            },
                          },
                        },
                      },
                    },
                    restarting: { after: { perceptionRestart: 'active' } },
                    failed: {
                      on: {
                        RETRY_PERCEPTION: {
                          target: 'active',
                          actions: tryOnSetup.assign({ perceptionRestarts: 0 }),
                        },
                      },
                      initial: 'crashed',
                      states: {
                        modelFetch: {},
                        wasmFetch: {},
                        unsupported: {},
                        captureUnsupported: {},
                        crashed: {},
                      },
                    },
                  },
                },
              },
            },

            photo: {
              on: { USE_CAMERA: '#tryOn.session.source.live' },
              exit: assign({ photo: null }),
              initial: 'choosing',
              states: {
                choosing: { on: { PHOTO_SELECTED: choosePhoto } },
                detecting: {
                  invoke: {
                    src: 'detectPhoto',
                    input: ({ context }) => ({ photo: context.photo }),
                    onDone: [
                      { guard: ({ event }) => event.output.faceFound, target: 'showing' },
                      { target: 'noFace' },
                    ],
                    onError: 'failed',
                  },
                },
                showing: { on: { PHOTO_SELECTED: choosePhoto } },
                noFace: { on: { PHOTO_SELECTED: choosePhoto } },
                failed: { on: { PHOTO_SELECTED: choosePhoto, RETRY_PHOTO: 'detecting' } },
              },
            },
          },
        },
      },
    },
  },
});

export type TryOnMachine = typeof tryOnMachine;
