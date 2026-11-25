import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { PerceptionError } from '../errors';
import type { CapturedFrame } from '../frameSource';
import { startLandmarker, type LandmarkerClientOptions } from '../landmarkerClient';
import { LANDMARK_COUNT, type LandmarkFrame } from '../types';
import type { ProbeEvent } from '../../utils/probe';

class FakeWorker extends EventTarget {
  posted: { message: unknown; transfer: unknown }[] = [];
  terminated = false;

  postMessage(message: unknown, transfer?: unknown) {
    this.posted.push({ message, transfer });
  }

  terminate() {
    this.terminated = true;
  }

  reply(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

const ASSETS = { wasmBaseUrl: '/w', modelUrl: '/m.task' };

// The frame plus its close mock, so tests can check which frames were released.
const captured = (frameId: number): CapturedFrame & { close: Mock<() => void> } => {
  const close = vi.fn<() => void>();
  const frame = { close, displayWidth: 640, displayHeight: 480 } as unknown as VideoFrame;
  return { frameId, frame, timestampMs: 1000 + frameId * 33, capturedAt: 10 + frameId * 33, close };
};

const faceFrame = (timestampMs: number): LandmarkFrame => ({
  timestampMs,
  width: 640,
  height: 480,
  landmarks: new Float32Array(LANDMARK_COUNT * 3),
  faceCount: 1,
  trackId: 1,
});

const result = (frameId: number) => ({
  type: 'result',
  frameId,
  inferenceStartMs: performance.timeOrigin + 40,
  inferenceMs: 6.5,
  landmarkFrame: faceFrame(1000 + frameId * 33),
});

const frameIdsPosted = (worker: FakeWorker) =>
  worker.posted
    .map(({ message }) => message as { type: string; frameId?: number })
    .filter((message) => message.type === 'frame')
    .map((message) => message.frameId);

describe('landmarker client', () => {
  let worker: FakeWorker;
  let probes: ProbeEvent[];
  let options: LandmarkerClientOptions;
  let onResult: Mock<(frame: LandmarkFrame) => void>;
  let onError: Mock<(error: PerceptionError) => void>;

  beforeEach(() => {
    worker = new FakeWorker();
    probes = [];
    window.__facefitProbe = (event) => probes.push(event);
    onResult = vi.fn();
    onError = vi.fn();
    options = {
      assets: ASSETS,
      onResult,
      onError,
      createWorker: () => worker as unknown as Worker,
    };
  });

  afterEach(() => {
    delete window.__facefitProbe;
  });

  it('sends init with the asset paths and resolves ready with the delegate', async () => {
    const client = startLandmarker(options);
    expect(worker.posted[0]?.message).toEqual({ type: 'init', ...ASSETS, runningMode: 'VIDEO' });

    worker.reply({ type: 'ready', delegate: 'CPU' });
    await expect(client.ready).resolves.toBe('CPU');
  });

  it('closes frames submitted before the model is ready instead of sending them', () => {
    const client = startLandmarker(options);
    const early = captured(0);
    client.submit(early);

    expect(frameIdsPosted(worker)).toEqual([]);
    expect(early.close).toHaveBeenCalledTimes(1);
  });

  it('transfers frames, keeps one in flight and drops the stale waiting frame', async () => {
    const client = startLandmarker(options);
    worker.reply({ type: 'ready', delegate: 'GPU' });
    await client.ready;

    const frames = [captured(0), captured(1), captured(2)];
    frames.forEach((frame) => client.submit(frame));

    expect(frameIdsPosted(worker)).toEqual([0]);
    expect(worker.posted[1]?.transfer).toEqual([frames[0]?.frame]);
    expect(frames[1]?.close).toHaveBeenCalledTimes(1);
    expect(probes).toContainEqual({ stage: 'drop', frameId: 1 });

    worker.reply(result(0));
    expect(frameIdsPosted(worker)).toEqual([0, 2]);
    expect(onResult).toHaveBeenCalledWith(faceFrame(1000));
  });

  it('probes each step from capture to receipt, with worker times on the main-thread clock', async () => {
    const now = vi.spyOn(performance, 'now');
    const client = startLandmarker(options);
    worker.reply({ type: 'ready', delegate: 'GPU' });
    await client.ready;
    now.mockReturnValue(10.5);
    client.submit(captured(0));

    now.mockReturnValue(55);
    worker.reply(result(0));

    expect(probes).toEqual([
      { stage: 'frameToPost', frameId: 0, start: 10, end: 10.5 },
      { stage: 'frameToLandmarks', frameId: 0, start: 10, end: 55 },
      { stage: 'inference', frameId: 0, durationMs: 6.5, start: 40, end: 46.5 },
      { stage: 'result', frameId: 0, start: 55, end: 55 },
    ]);
    now.mockRestore();
  });

  it('probes the post time of a waiting frame when the worker takes it', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(20);
    const client = startLandmarker(options);
    worker.reply({ type: 'ready', delegate: 'GPU' });
    await client.ready;
    client.submit(captured(0));
    client.submit(captured(1));

    now.mockReturnValue(60);
    worker.reply(result(0));

    expect(probes.filter((event) => event.stage === 'frameToPost')).toEqual([
      { stage: 'frameToPost', frameId: 0, start: 10, end: 20 },
      { stage: 'frameToPost', frameId: 1, start: 43, end: 60 },
    ]);
    now.mockRestore();
  });

  it('rejects ready with the worker error code and terminates the worker', async () => {
    const client = startLandmarker(options);
    worker.reply({ type: 'error', code: 'wasm-fetch', detail: 'HTTP 404' });

    await expect(client.ready).rejects.toEqual(new PerceptionError('wasm-fetch', 'HTTP 404'));
    expect(worker.terminated).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports a failure after ready through onError and releases the waiting frame', async () => {
    const client = startLandmarker(options);
    worker.reply({ type: 'ready', delegate: 'GPU' });
    await client.ready;
    client.submit(captured(0));
    const waiting = captured(1);
    client.submit(waiting);

    worker.reply({ type: 'error', code: 'inference', detail: 'context lost', frameId: 0 });

    const error = onError.mock.calls[0]?.[0] as PerceptionError;
    expect(error).toBeInstanceOf(PerceptionError);
    expect(error.code).toBe('inference');
    expect(worker.terminated).toBe(true);
    expect(waiting.close).toHaveBeenCalledTimes(1);
  });

  it('stops tracking on an error for a single frame instead of skipping that frame', async () => {
    const client = startLandmarker(options);
    worker.reply({ type: 'ready', delegate: 'GPU' });
    await client.ready;
    client.submit(captured(0));
    client.submit(captured(1));

    worker.reply({ type: 'error', code: 'inference', detail: 'graph failed', frameId: 0 });
    const later = captured(2);
    client.submit(later);
    worker.reply(result(1));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(frameIdsPosted(worker)).toEqual([0]);
    expect(later.close).toHaveBeenCalledTimes(1);
    expect(onResult).not.toHaveBeenCalled();
  });

  it('probes a request the worker guard blocked and keeps running', async () => {
    const client = startLandmarker(options);
    worker.reply({ type: 'blocked', api: 'fetch', url: 'https://odml.pa.googleapis.com/v1/log' });
    worker.reply({ type: 'ready', delegate: 'GPU' });

    await expect(client.ready).resolves.toBe('GPU');
    expect(probes).toEqual([
      { stage: 'blockedRequest', api: 'fetch', url: 'https://odml.pa.googleapis.com/v1/log' },
    ]);
    expect(worker.terminated).toBe(false);
  });

  it('maps a worker script error to the worker code', async () => {
    const client = startLandmarker(options);
    worker.dispatchEvent(new ErrorEvent('error', { message: 'SyntaxError in worker' }));

    await expect(client.ready).rejects.toMatchObject({
      code: 'worker',
      message: 'SyntaxError in worker',
    });
  });

  it('treats a malformed reply as a worker failure', async () => {
    const client = startLandmarker(options);
    worker.reply({ type: 'result', frameId: 0 });

    await expect(client.ready).rejects.toMatchObject({ code: 'worker' });
  });

  it('on stop with a frame in flight, terminates, releases the waiting frame and ignores the late result', async () => {
    const client = startLandmarker(options);
    worker.reply({ type: 'ready', delegate: 'GPU' });
    await client.ready;
    client.submit(captured(0));
    const waiting = captured(1);
    client.submit(waiting);

    client.stop();
    worker.reply(result(0));

    expect(worker.terminated).toBe(true);
    expect(waiting.close).toHaveBeenCalledTimes(1);
    expect(onResult).not.toHaveBeenCalled();
    expect(frameIdsPosted(worker)).toEqual([0]);
  });

  it('turns a worker that cannot be constructed into a worker error', () => {
    const blocked = () => {
      throw new DOMException('Refused by worker-src', 'SecurityError');
    };
    expect(() => startLandmarker({ ...options, createWorker: blocked })).toThrow(PerceptionError);
  });

  it('detects a still image in IMAGE mode and transfers the bitmap', async () => {
    const client = startLandmarker({ ...options, runningMode: 'IMAGE' });
    expect(worker.posted[0]?.message).toMatchObject({ type: 'init', runningMode: 'IMAGE' });
    worker.reply({ type: 'ready', delegate: 'GPU' });
    await client.ready;

    const image = { width: 640, height: 480, close: vi.fn() } as unknown as ImageBitmap;
    const detected = client.detectImage(image);
    expect(worker.posted[1]).toEqual({
      message: { type: 'image', requestId: 0, image },
      transfer: [image],
    });
    worker.reply({ type: 'imageResult', requestId: 0, landmarkFrame: faceFrame(0) });
    await expect(detected).resolves.toMatchObject({ faceCount: 1, width: 640 });
  });

  it('rejects a pending image when the worker fails or stops', async () => {
    const client = startLandmarker({ ...options, runningMode: 'IMAGE' });
    worker.reply({ type: 'ready', delegate: 'GPU' });
    await client.ready;
    const image = () => ({ width: 1, height: 1, close: vi.fn() }) as unknown as ImageBitmap;

    const failed = client.detectImage(image());
    worker.reply({ type: 'error', code: 'inference', detail: 'graph failed' });
    await expect(failed).rejects.toMatchObject({ code: 'inference' });

    const second = startLandmarker({ ...options, runningMode: 'IMAGE' });
    worker.reply({ type: 'ready', delegate: 'GPU' });
    await second.ready;
    const stopped = second.detectImage(image());
    second.stop();
    await expect(stopped).rejects.toMatchObject({ code: 'worker' });
  });

  it('refuses an image before the model is ready and closes it', async () => {
    const client = startLandmarker({ ...options, runningMode: 'IMAGE' });
    const close = vi.fn();
    await expect(client.detectImage({ width: 1, height: 1, close })).rejects.toBeInstanceOf(
      PerceptionError,
    );
    expect(close).toHaveBeenCalled();
  });

  it('rejects a pending ready on stop', async () => {
    const client = startLandmarker(options);
    client.stop();
    await expect(client.ready).rejects.toMatchObject({ code: 'worker' });
  });
});
