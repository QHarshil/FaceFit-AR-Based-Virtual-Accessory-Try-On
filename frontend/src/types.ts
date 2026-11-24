import type { LandmarkFrame } from './perception/types';

export type ProductType = 'glasses';

type Point3 = [number, number, number];

/** Points in the model's frame, in millimetres (see assets/README.md). */
export interface ProductAnchors {
  bridgeCenter: Point3;
  nosePadLeft: Point3;
  nosePadRight: Point3;
  hingeLeft: Point3;
  hingeRight: Point3;
}

export interface Product {
  id: number;
  name: string;
  category: string;
  type: ProductType;
  modelPath: string;
  description: string;
  anchors: ProductAnchors;
  image?: string;
}

export interface ARTryOnHandle {
  updateModel: (frame: LandmarkFrame) => void;
}
