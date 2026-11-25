import { estimateIntrinsics } from '@facefit/cv';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActor, createMachine, fromPromise, type AnyActorLogic } from 'xstate';
import { ApiError } from '../../services/apiClient';
import { PRODUCTS } from '../../test/fixtures';
import { rotationFromDegrees, syntheticLandmarkFrame } from '../../test/syntheticFace';
import { deferred, flush, PRODUCT, type Deferred } from '../../test/tryOnHarness';
import { createPoseStream } from '../../tracking/poseStream';
import type { LandmarkFrame } from '../../perception/types';
import { createTryOnActors } from '../actors';
import { tryOnMachine } from '../machine';

const NO_FACE_FRAME: LandmarkFrame = {
  timestampMs: 0,
  width: 640,
  height: 480,
  landmarks: new Float32Array(0),
  faceCount: 0,
  trackId: null,
};

const actors = (getProduct = vi.fn()) =>
  createTryOnActors({ video: { current: null }, poseStream: createPoseStream(), getProduct });

/** Runs one actor under a parent that records what it sends back. */
const runChild = (logic: AnyActorLogic, input?: unknown) => {
  const received: string[] = [];
  const parent = createActor(
    createMachine({
      invoke: { src: logic, input },
      on: { '*': { actions: ({ event }) => received.push(event.type) } },
    }),
  );
  parent.start();
  return { parent, received };
};

describe('try-on actors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects an invalid product id as not found without a request', async () => {
    const getProduct = vi.fn();
    const outcome = createActor(actors(getProduct).loadProduct, { input: { productId: null } });
    const failure = new Promise((resolve) => outcome.subscribe({ error: resolve }));
    outcome.start();
    const error = await failure;
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).failure).toBe('not_found');
    expect(getProduct).not.toHaveBeenCalled();
  });

  it('loads a valid product with an abort signal', async () => {
    const getProduct = vi.fn().mockResolvedValue(PRODUCTS[0]);
    const outcome = createActor(actors(getProduct).loadProduct, { input: { productId: 1 } });
    const done = new Promise((resolve) =>
      outcome.subscribe((snapshot) => snapshot.output && resolve(snapshot.output)),
    );
    outcome.start();
    expect(await done).toEqual(PRODUCTS[0]);
    expect(getProduct).toHaveBeenCalledWith(1, expect.any(AbortSignal));
  });

  it('reports page visibility, including a page that starts hidden', () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const { parent, received } = runChild(actors().pageVisibility);
    expect(received).toEqual(['PAGE_HIDDEN']);

    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(received).toEqual(['PAGE_HIDDEN', 'PAGE_VISIBLE']);

    parent.stop();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(received).toHaveLength(2);
  });

  it('reports camera device changes until stopped', () => {
    const devices = new EventTarget();
    // jsdom has no mediaDevices.
    Object.defineProperty(navigator, 'mediaDevices', { value: devices, configurable: true });
    const { parent, received } = runChild(actors().deviceWatcher);

    devices.dispatchEvent(new Event('devicechange'));
    expect(received).toEqual(['DEVICE_CHANGE']);
    parent.stop();
    devices.dispatchEvent(new Event('devicechange'));
    expect(received).toEqual(['DEVICE_CHANGE']);
    Reflect.deleteProperty(navigator, 'mediaDevices');
  });

  it('shows a detected photo on the pose stream, unless the user left photo mode first', async () => {
    const poseStream = createPoseStream();
    const showStill = vi.spyOn(poseStream, 'showStill');
    let finish: (frame: LandmarkFrame) => void = () => {};
    const set = createTryOnActors({
      video: { current: null },
      poseStream,
      detectPhoto: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const left = createActor(set.detectPhoto, { input: { photo: new Blob(['x']) } });
    left.start();
    left.stop();
    finish(NO_FACE_FRAME);
    await Promise.resolve();
    await Promise.resolve();
    expect(showStill).not.toHaveBeenCalled();

    const stayed = createActor(set.detectPhoto, { input: { photo: new Blob(['x']) } });
    const done = new Promise((resolve) =>
      stayed.subscribe((snapshot) => snapshot.output && resolve(snapshot.output)),
    );
    stayed.start();
    finish(NO_FACE_FRAME);
    expect(await done).toEqual({ faceFound: false });
    expect(showStill).toHaveBeenCalledWith(NO_FACE_FRAME);
  });

  it('aborts photo detection when the user leaves photo mode', () => {
    const signals: AbortSignal[] = [];
    const set = createTryOnActors({
      video: { current: null },
      poseStream: createPoseStream(),
      detectPhoto: (_photo, signal) => {
        signals.push(signal);
        return new Promise(() => {});
      },
    });
    const detection = createActor(set.detectPhoto, { input: { photo: new Blob(['x']) } });
    detection.start();
    expect(signals[0]?.aborted).toBe(false);
    detection.stop();
    expect(signals[0]?.aborted).toBe(true);
  });

  it('clears the last photo pose as soon as another photo is chosen', async () => {
    const poseStream = createPoseStream();
    const detections: Deferred<LandmarkFrame>[] = [];
    const set = createTryOnActors({
      video: { current: null },
      poseStream,
      detectPhoto: () => {
        const detection = deferred<LandmarkFrame>();
        detections.push(detection);
        return detection.promise;
      },
    });
    const machine = tryOnMachine.provide({
      actors: {
        loadProduct: fromPromise(() => Promise.resolve(PRODUCT)),
        detectPhoto: set.detectPhoto,
      },
    });
    const tryOn = createActor(machine, { input: { productId: PRODUCT.id } });
    tryOn.start();
    await flush();
    tryOn.send({ type: 'USE_PHOTO' });
    tryOn.send({ type: 'PHOTO_SELECTED', photo: new Blob(['first']) });
    const photo = estimateIntrinsics({ width: 820, height: 1024, horizontalFovDeg: 40 })!;
    detections[0]?.resolve(
      syntheticLandmarkFrame(
        { rotation: rotationFromDegrees(0, 10, 0), translationMm: [0, 0, (photo.fx * 150) / 320] },
        photo,
      ),
    );
    await flush();
    expect(tryOn.getSnapshot().matches({ session: { source: { photo: 'showing' } } })).toBe(true);
    expect(poseStream.poseForRender()).not.toBeNull();

    tryOn.send({ type: 'PHOTO_SELECTED', photo: new Blob(['second']) });
    expect(poseStream.poseForRender()).toBeNull();
    tryOn.stop();
  });

  it('fails the camera and perception without a video element', () => {
    const set = actors();
    expect(runChild(set.camera).received).toEqual(['CAMERA_FAILED']);
    expect(runChild(set.perception).received).toEqual(['PERCEPTION_FAILED']);
  });
});
