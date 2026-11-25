// What the try-on shows for each state: one status picked from the parallel
// regions by priority, and its text, announcement and recovery actions.
import type { SnapshotFrom } from 'xstate';
import type { TryOnEvent, TryOnMachine } from './machine';

export const TRY_ON_STATUSES = [
  'productLoading',
  'productNotFound',
  'productUnavailable',
  'cameraRequesting',
  'cameraDenied',
  'cameraMissing',
  'cameraBusy',
  'cameraUnsupported',
  'cameraFailed',
  'cameraEnded',
  'modelLoading',
  'trackingRestarting',
  'modelFetchFailed',
  'wasmFetchFailed',
  'trackingUnsupported',
  'captureUnsupported',
  'trackingCrashed',
  'glassesLoading',
  'glassesFailed',
  'webglUnavailable',
  'contextLost',
  'paused',
  'searching',
  'lowLight',
  'multipleFaces',
  'faceLost',
  'faceTurned',
  'tracking',
  'photoChoosing',
  'photoDetecting',
  'photoShowing',
  'photoNoFace',
  'photoFailed',
] as const;

export type TryOnStatus = (typeof TRY_ON_STATUSES)[number];

type Snapshot = SnapshotFrom<TryOnMachine>;

type CameraState =
  'denied' | 'missing' | 'busy' | 'unsupported' | 'failed' | 'ended' | { active: 'requesting' };
type PerceptionState =
  | 'restarting'
  | { failed: 'modelFetch' | 'wasmFetch' | 'unsupported' | 'captureUnsupported' | 'crashed' }
  | { active: 'loading' }
  | { active: { running: FaceState } };
type FaceState = 'searching' | 'lowLight' | 'multiple' | 'lost' | 'tracking';

const liveIn = (
  region: { camera: CameraState } | { perception: PerceptionState } | { visibility: 'hidden' },
) => ({ session: { source: { live: region } } });

type PayloadFree<E> = E extends { type: infer T } ? (keyof E extends 'type' ? T : never) : never;

/** Events a recovery button can send: the ones without a payload. */
export type RecoveryEvent = PayloadFree<TryOnEvent>;

export type StatusAction =
  | { kind: 'send'; event: RecoveryEvent; label: string }
  | { kind: 'home'; label: string }
  | { kind: 'pickPhoto'; label: string };

export interface StatusView {
  tone: 'progress' | 'info' | 'success' | 'warning' | 'error';
  title: string;
  detail?: string;
  /** Read by screen readers when the status changes. */
  announcement: string;
  actions: readonly [StatusAction, ...StatusAction[]];
}

const HOME: StatusAction = { kind: 'home', label: 'Back to catalogue' };
const send = (event: RecoveryEvent, label: string): StatusAction => ({
  kind: 'send',
  event,
  label,
});
const USE_PHOTO = send('USE_PHOTO', 'Use a photo');
const USE_CAMERA = send('USE_CAMERA', 'Use the camera');
const PICK_PHOTO: StatusAction = { kind: 'pickPhoto', label: 'Choose a photo' };

const view = (
  tone: StatusView['tone'],
  title: string,
  detail: string | null,
  actions: StatusView['actions'],
): StatusView => {
  const announcement = detail ? `${title}. ${detail}` : `${title}.`;
  return detail
    ? { tone, title, detail, announcement, actions }
    : { tone, title, announcement, actions };
};

export const STATUS_VIEWS: Record<TryOnStatus, StatusView> = {
  productLoading: view('progress', 'Loading the frame', null, [HOME]),
  productNotFound: view('error', 'Frame not found', 'This frame is not in the catalogue.', [HOME]),
  productUnavailable: view(
    'error',
    'Could not load this frame',
    'Check your connection and try again.',
    [send('RETRY_PRODUCT', 'Try again'), HOME],
  ),
  cameraRequesting: view(
    'progress',
    'Waiting for the camera',
    'Allow camera access when your browser asks.',
    [USE_PHOTO, HOME],
  ),
  cameraDenied: view(
    'error',
    'Camera access is blocked',
    'Allow the camera in your browser settings for this site, then try again.',
    [send('RETRY_CAMERA', 'Try again'), USE_PHOTO, HOME],
  ),
  cameraMissing: view('error', 'No camera found', 'Connect a camera or use a photo.', [
    send('RETRY_CAMERA', 'Try again'),
    USE_PHOTO,
    HOME,
  ]),
  cameraBusy: view(
    'error',
    'The camera is in use',
    'Close other apps that use the camera, then try again.',
    [send('RETRY_CAMERA', 'Try again'), USE_PHOTO, HOME],
  ),
  cameraUnsupported: view(
    'error',
    'This page cannot use a camera',
    'Open it over https in a recent browser, or use a photo.',
    [USE_PHOTO, HOME],
  ),
  cameraFailed: view('error', 'The camera did not start', 'Try again or use a photo.', [
    send('RETRY_CAMERA', 'Try again'),
    USE_PHOTO,
    HOME,
  ]),
  cameraEnded: view('warning', 'The camera disconnected', 'Reconnect it and try again.', [
    send('RETRY_CAMERA', 'Try again'),
    USE_PHOTO,
    HOME,
  ]),
  modelLoading: view('progress', 'Loading face tracking', null, [HOME]),
  trackingRestarting: view('progress', 'Restarting face tracking', null, [HOME]),
  modelFetchFailed: view(
    'error',
    'Could not download the face tracking model',
    'Check your connection and try again.',
    [send('RETRY_PERCEPTION', 'Try again'), HOME],
  ),
  wasmFetchFailed: view(
    'error',
    'Could not load the face tracking engine',
    'Check your connection and try again.',
    [send('RETRY_PERCEPTION', 'Try again'), HOME],
  ),
  trackingUnsupported: view(
    'error',
    'Face tracking does not run in this browser',
    'Try a recent Chrome, Edge, Firefox or Safari.',
    [HOME],
  ),
  captureUnsupported: view(
    'error',
    'This browser cannot track live video',
    'Try on with a photo instead.',
    [USE_PHOTO, HOME],
  ),
  trackingCrashed: view('error', 'Face tracking stopped', 'Try again to restart it.', [
    send('RETRY_PERCEPTION', 'Try again'),
    USE_PHOTO,
    HOME,
  ]),
  glassesLoading: view('progress', 'Loading the 3D frame', null, [HOME]),
  glassesFailed: view(
    'error',
    'Could not load the 3D frame',
    'Check your connection and try again.',
    [send('RETRY_OVERLAY', 'Try again'), HOME],
  ),
  webglUnavailable: view(
    'error',
    '3D rendering is off',
    'Turn on hardware acceleration in your browser settings, then try again.',
    [send('RETRY_OVERLAY', 'Try again'), HOME],
  ),
  contextLost: view('warning', 'Graphics were interrupted', 'Restoring the view.', [
    send('RETRY_OVERLAY', 'Reload the view'),
    HOME,
  ]),
  paused: view('info', 'Paused', 'The camera is off while this tab is hidden.', [HOME]),
  searching: view('info', 'Looking for your face', 'Face the camera in good light.', [
    USE_PHOTO,
    HOME,
  ]),
  lowLight: view('warning', 'Too dark to find your face', 'Add light in front of you.', [
    USE_PHOTO,
    HOME,
  ]),
  multipleFaces: view(
    'info',
    'More than one face in view',
    'The frame stays on the first face it found.',
    [USE_PHOTO, HOME],
  ),
  faceLost: view('warning', 'Face not found', 'Move back into view.', [USE_PHOTO, HOME]),
  faceTurned: view('info', 'Face the camera', 'The frame shows when you face the camera.', [
    USE_PHOTO,
    HOME,
  ]),
  tracking: view('success', 'Tracking', null, [USE_PHOTO, HOME]),
  photoChoosing: view(
    'info',
    'Try on with a photo',
    'Choose a clear, front-facing photo. It stays on this device.',
    [PICK_PHOTO, USE_CAMERA, HOME],
  ),
  photoDetecting: view('progress', 'Finding your face', null, [USE_CAMERA, HOME]),
  photoShowing: view('success', 'Photo try-on', 'The photo stays on this device.', [
    { kind: 'pickPhoto', label: 'Choose another photo' },
    USE_CAMERA,
    HOME,
  ]),
  photoNoFace: view('warning', 'No face in this photo', 'Choose a clear, front-facing photo.', [
    PICK_PHOTO,
    USE_CAMERA,
    HOME,
  ]),
  photoFailed: view('error', 'Could not read this photo', 'Try another image file.', [
    PICK_PHOTO,
    send('RETRY_PHOTO', 'Try again'),
    USE_CAMERA,
    HOME,
  ]),
};

const overlayStatus = (s: Snapshot): TryOnStatus | null => {
  if (s.matches({ session: { overlay: 'noWebgl' } })) return 'webglUnavailable';
  if (s.matches({ session: { overlay: 'failed' } })) return 'glassesFailed';
  return null;
};

const photoStatus = (s: Snapshot): TryOnStatus => {
  const photo = (state: 'choosing' | 'detecting' | 'showing' | 'noFace' | 'failed') =>
    s.matches({ session: { source: { photo: state } } });
  if (photo('choosing')) return 'photoChoosing';
  if (photo('detecting')) return 'photoDetecting';
  if (photo('noFace')) return 'photoNoFace';
  if (photo('failed')) return 'photoFailed';
  if (s.matches({ session: { overlay: 'contextLost' } })) return 'contextLost';
  if (s.matches({ session: { overlay: 'loading' } })) return 'glassesLoading';
  return 'photoShowing';
};

const liveStatus = (s: Snapshot): TryOnStatus => {
  const camera = (state: CameraState) => s.matches(liveIn({ camera: state }));
  const perception = (state: PerceptionState) => s.matches(liveIn({ perception: state }));
  const face = (state: FaceState) => perception({ active: { running: state } });

  if (s.matches(liveIn({ visibility: 'hidden' }))) return 'paused';
  if (camera('denied')) return 'cameraDenied';
  if (camera('missing')) return 'cameraMissing';
  if (camera('busy')) return 'cameraBusy';
  if (camera('unsupported')) return 'cameraUnsupported';
  if (camera('failed')) return 'cameraFailed';
  if (camera('ended')) return 'cameraEnded';
  if (perception({ failed: 'modelFetch' })) return 'modelFetchFailed';
  if (perception({ failed: 'wasmFetch' })) return 'wasmFetchFailed';
  if (perception({ failed: 'unsupported' })) return 'trackingUnsupported';
  if (perception({ failed: 'captureUnsupported' })) return 'captureUnsupported';
  if (perception({ failed: 'crashed' })) return 'trackingCrashed';
  if (s.matches({ session: { overlay: 'contextLost' } })) return 'contextLost';
  if (camera({ active: 'requesting' })) return 'cameraRequesting';
  if (perception({ active: 'loading' })) return 'modelLoading';
  if (perception('restarting')) return 'trackingRestarting';
  if (s.matches({ session: { overlay: 'loading' } })) return 'glassesLoading';
  if (face('tracking')) return 'tracking';
  if (face('multiple')) return 'multipleFaces';
  if (face('lost')) return 'faceLost';
  if (face('lowLight')) return 'lowLight';
  if (face('searching')) return 'searching';
  // Camera or perception paused: only while the page is hidden.
  return 'paused';
};

/** The one status the page shows for a machine snapshot. */
export const statusOf = (s: Snapshot): TryOnStatus => {
  if (s.matches({ product: 'loading' })) return 'productLoading';
  if (s.matches({ product: 'notFound' })) return 'productNotFound';
  if (s.matches({ product: 'unavailable' })) return 'productUnavailable';
  const overlay = overlayStatus(s);
  if (overlay) return overlay;
  if (s.matches({ session: { source: 'photo' } })) return photoStatus(s);
  return liveStatus(s);
};

/**
 * The pose stream's view of a tracked face: the gate can hide the overlay
 * while the face is in view, for example with the head turned far aside.
 */
export const withPose = (status: TryOnStatus, poseShown: boolean): TryOnStatus =>
  status === 'tracking' && !poseShown ? 'faceTurned' : status;

/** Session-level state the view needs besides the status. */
export const sourceOf = (s: Snapshot): 'live' | 'photo' | null => {
  if (!s.matches('session')) return null;
  return s.matches({ session: { source: 'photo' } }) ? 'photo' : 'live';
};
