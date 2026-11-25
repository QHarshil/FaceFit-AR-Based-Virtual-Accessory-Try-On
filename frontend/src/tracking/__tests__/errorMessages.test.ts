import { describe, expect, it } from 'vitest';
import { PerceptionError } from '../../perception/errors';
import type { PerceptionErrorCode } from '../../perception/protocol';
import { CAMERA_ERROR_MESSAGE, trackingErrorMessage } from '../errorMessages';

describe('trackingErrorMessage', () => {
  it.each<[PerceptionErrorCode, RegExp]>([
    ['model-fetch', /download the face tracking model/],
    ['wasm-fetch', /load the face tracking engine/],
    ['worker', /ran into a problem/],
    ['inference', /ran into a problem/],
    ['unsupported', /not supported in this browser/],
  ])('gives %s its own message', (code, message) => {
    expect(trackingErrorMessage(new PerceptionError(code, 'detail'))).toMatch(message);
  });

  it('treats a rejected camera request as a camera error', () => {
    expect(trackingErrorMessage(new DOMException('denied', 'NotAllowedError'))).toBe(
      CAMERA_ERROR_MESSAGE,
    );
    expect(trackingErrorMessage(new DOMException('none', 'NotFoundError'))).toBe(
      CAMERA_ERROR_MESSAGE,
    );
  });

  it('does not blame the camera for an unknown failure', () => {
    expect(trackingErrorMessage(new TypeError('x is undefined'))).not.toBe(CAMERA_ERROR_MESSAGE);
  });
});
