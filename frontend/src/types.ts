import type { LandmarkFrame } from './perception/types';

export type { Attribution, Product, ProductAnchors } from '@facefit/contracts';

export interface ARTryOnHandle {
  updateModel: (frame: LandmarkFrame) => void;
  /** A camera frame captured at `timestampMs` (the landmark frame clock) is on screen. */
  presentFrame: (timestampMs: number) => void;
}
