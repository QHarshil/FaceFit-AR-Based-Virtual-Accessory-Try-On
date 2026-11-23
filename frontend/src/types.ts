import type { LandmarkFrame } from './perception/types';

export type ProductType = 'glasses' | 'hat';

export interface Product {
  id: number;
  name: string;
  category: string;
  type: ProductType;
  modelPath: string;
  description: string;
  image?: string;
}

export interface ARTryOnHandle {
  updateModel: (frame: LandmarkFrame | null) => void;
}
