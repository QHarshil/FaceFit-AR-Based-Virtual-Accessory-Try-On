import { describe, expect, it } from 'vitest';
import {
  isLandmarkFrame,
  isWorkerRequest,
  isWorkerResponse,
  transferablesOf,
  type ResultResponse,
} from '../protocol';
import { LANDMARK_COUNT, landmarkPoint, type LandmarkFrame } from '../types';

const faceFrame = (): LandmarkFrame => {
  const landmarks = new Float32Array(LANDMARK_COUNT * 3);
  landmarks.forEach((_, i) => {
    landmarks[i] = i / landmarks.length;
  });
  return { timestampMs: 12.5, width: 1280, height: 720, landmarks, faceCount: 1, trackId: 3 };
};

const emptyFrame = (): LandmarkFrame => ({
  timestampMs: 12.5,
  width: 1280,
  height: 720,
  landmarks: new Float32Array(0),
  faceCount: 0,
  trackId: null,
});

const fakeVideoFrame = () => ({ displayWidth: 1280, displayHeight: 720, close: () => {} });

describe('LandmarkFrame', () => {
  it('accepts a face frame and an empty frame', () => {
    expect(isLandmarkFrame(faceFrame())).toBe(true);
    expect(isLandmarkFrame(emptyFrame())).toBe(true);
  });

  it('accepts faces detected without a tracked one, while the tracked face is missed', () => {
    expect(isLandmarkFrame({ ...emptyFrame(), faceCount: 1 })).toBe(true);
  });

  it('rejects a face count that does not match the landmark buffer', () => {
    expect(isLandmarkFrame({ ...faceFrame(), faceCount: 0 })).toBe(false);
    expect(isLandmarkFrame({ ...faceFrame(), landmarks: new Float32Array(468 * 3) })).toBe(false);
    expect(isLandmarkFrame({ ...faceFrame(), landmarks: Array.from(faceFrame().landmarks) })).toBe(
      false,
    );
  });

  it('requires a track id with a face and none without', () => {
    expect(isLandmarkFrame({ ...faceFrame(), trackId: null })).toBe(false);
    expect(isLandmarkFrame({ ...faceFrame(), trackId: -1 })).toBe(false);
    expect(isLandmarkFrame({ ...faceFrame(), trackId: 1.5 })).toBe(false);
    expect(isLandmarkFrame({ ...faceFrame(), trackId: undefined })).toBe(false);
    expect(isLandmarkFrame({ ...emptyFrame(), trackId: 3 })).toBe(false);
  });

  it('accepts a luminance from 0 to 255 and rejects anything else', () => {
    expect(isLandmarkFrame({ ...emptyFrame(), luminance: 0 })).toBe(true);
    expect(isLandmarkFrame({ ...faceFrame(), luminance: 255 })).toBe(true);
    for (const luminance of [-1, 256, Number.NaN, '40', null]) {
      expect(isLandmarkFrame({ ...emptyFrame(), luminance })).toBe(false);
    }
  });

  it('reads interleaved points by index', () => {
    const frame = faceFrame();
    const n = frame.landmarks.length;
    expect(landmarkPoint(frame, 0)).toEqual({ x: 0, y: Math.fround(1 / n), z: Math.fround(2 / n) });
    expect(landmarkPoint(frame, 477).z).toBeCloseTo((n - 1) / n, 6);
    expect(() => landmarkPoint(frame, 478)).toThrow(RangeError);
    expect(() => landmarkPoint(emptyFrame(), 0)).toThrow(RangeError);
  });
});

describe('worker requests', () => {
  it('accepts init and frame messages', () => {
    expect(isWorkerRequest({ type: 'init', wasmBaseUrl: '/w', modelUrl: '/m.task' })).toBe(true);
    expect(
      isWorkerRequest({ type: 'frame', frameId: 3, timestampMs: 100, frame: fakeVideoFrame() }),
    ).toBe(true);
  });

  it('accepts an IMAGE init and an image request, and rejects a bad mode or bitmap', () => {
    const bitmap = { width: 640, height: 480, close: () => {} };
    expect(
      isWorkerRequest({ type: 'init', wasmBaseUrl: '/w', modelUrl: '/m', runningMode: 'IMAGE' }),
    ).toBe(true);
    expect(
      isWorkerRequest({ type: 'init', wasmBaseUrl: '/w', modelUrl: '/m', runningMode: 'LIVE' }),
    ).toBe(false);
    expect(isWorkerRequest({ type: 'image', requestId: 0, image: bitmap })).toBe(true);
    expect(isWorkerRequest({ type: 'image', requestId: -1, image: bitmap })).toBe(false);
    expect(isWorkerRequest({ type: 'image', requestId: 0, image: { width: 1 } })).toBe(false);
    expect(
      transferablesOf({ type: 'image', requestId: 0, image: bitmap as unknown as ImageBitmap }),
    ).toEqual([bitmap]);
  });

  it('accepts an image result with a landmark frame and transfers its buffer', () => {
    const message = { type: 'imageResult', requestId: 2, landmarkFrame: faceFrame() } as const;
    expect(isWorkerResponse(message)).toBe(true);
    expect(isWorkerResponse({ ...message, requestId: 1.5 })).toBe(false);
    expect(transferablesOf(message)).toEqual([message.landmarkFrame.landmarks.buffer]);
  });

  it('rejects frames without a closable image or with a bad id', () => {
    expect(isWorkerRequest({ type: 'frame', frameId: 3, timestampMs: 100, frame: {} })).toBe(false);
    expect(
      isWorkerRequest({ type: 'frame', frameId: -1, timestampMs: 100, frame: fakeVideoFrame() }),
    ).toBe(false);
    expect(
      isWorkerRequest({ type: 'frame', frameId: 1, timestampMs: NaN, frame: fakeVideoFrame() }),
    ).toBe(false);
    expect(isWorkerRequest({ type: 'init', wasmBaseUrl: '/w' })).toBe(false);
    expect(isWorkerRequest(null)).toBe(false);
  });
});

describe('worker responses', () => {
  it('accepts ready, result and error messages', () => {
    expect(isWorkerResponse({ type: 'ready', delegate: 'GPU' })).toBe(true);
    expect(
      isWorkerResponse({
        type: 'result',
        frameId: 1,
        inferenceStartMs: 1.7e12,
        inferenceMs: 4,
        landmarkFrame: faceFrame(),
      }),
    ).toBe(true);
    expect(isWorkerResponse({ type: 'error', code: 'model-fetch', detail: 'HTTP 404' })).toBe(true);
    expect(isWorkerResponse({ type: 'error', code: 'inference', detail: 'lost', frameId: 9 })).toBe(
      true,
    );
  });

  it('accepts a blocked-request report and rejects one with an unknown API', () => {
    expect(
      isWorkerResponse({
        type: 'blocked',
        api: 'xhr',
        url: 'https://odml.pa.googleapis.com/v1/log',
      }),
    ).toBe(true);
    expect(isWorkerResponse({ type: 'blocked', api: 'websocket', url: 'wss://x' })).toBe(false);
    expect(isWorkerResponse({ type: 'blocked', api: 'fetch' })).toBe(false);
  });

  it('rejects unknown delegates, codes and malformed results', () => {
    expect(isWorkerResponse({ type: 'ready', delegate: 'WEBGPU' })).toBe(false);
    expect(isWorkerResponse({ type: 'error', code: 'oops', detail: '' })).toBe(false);
    expect(
      isWorkerResponse({
        type: 'result',
        frameId: 1,
        inferenceStartMs: 1.7e12,
        inferenceMs: 4,
        landmarkFrame: { ...faceFrame(), faceCount: 0 },
      }),
    ).toBe(false);
    expect(
      isWorkerResponse({ type: 'result', frameId: 1, inferenceMs: 4, landmarkFrame: faceFrame() }),
    ).toBe(false);
    expect(isWorkerResponse({ type: 'frame' })).toBe(false);
  });
});

describe('transferablesOf', () => {
  it('moves the video frame in and the landmark buffer out', () => {
    const frame = fakeVideoFrame() as unknown as VideoFrame;
    expect(transferablesOf({ type: 'frame', frameId: 1, timestampMs: 0, frame })).toEqual([frame]);

    const result: ResultResponse = {
      type: 'result',
      frameId: 1,
      inferenceStartMs: 1.7e12,
      inferenceMs: 4,
      landmarkFrame: faceFrame(),
    };
    expect(transferablesOf(result)).toEqual([result.landmarkFrame.landmarks.buffer]);
    expect(transferablesOf({ type: 'ready', delegate: 'CPU' })).toEqual([]);
  });
});
