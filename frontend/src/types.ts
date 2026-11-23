export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export type LandmarkList = readonly Landmark[];

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
  updateModel: (landmarks: LandmarkList | null) => void;
}
