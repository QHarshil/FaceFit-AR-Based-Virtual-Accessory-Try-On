import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActor, createMachine, type AnyActorLogic } from 'xstate';
import { ApiError } from '../../services/apiClient';
import { PRODUCTS } from '../../test/fixtures';
import { createPoseStream } from '../../tracking/poseStream';
import { createTryOnActors } from '../actors';

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

  it('fails the camera and perception without a video element', () => {
    const set = actors();
    expect(runChild(set.camera).received).toEqual(['CAMERA_FAILED']);
    expect(runChild(set.perception).received).toEqual(['PERCEPTION_FAILED']);
  });
});
