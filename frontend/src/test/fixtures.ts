import type { Product, ProductAnchors } from '../types';

// Product 1's anchors in assets/catalog.json.
export const ANCHORS: ProductAnchors = {
  bridgeCenter: [0, 0, 0],
  nosePadLeft: [9, -8, -0.9],
  nosePadRight: [-9, -8, -0.9],
  hingeLeft: [69, 0.5, -6.8],
  hingeRight: [-69, 0.5, -6.8],
};

export const PRODUCTS: Product[] = [
  {
    id: 1,
    name: 'Aviator Glasses',
    category: 'glasses',
    type: 'glasses',
    modelPath: '/models/rectangular-acetate.glb',
    description: 'Classic aviator style glasses',
    anchors: ANCHORS,
  },
  {
    id: 2,
    name: 'Round Glasses',
    category: 'glasses',
    type: 'glasses',
    modelPath: '/models/oval-wire-sunglasses.glb',
    description: 'Vintage round frame glasses',
    anchors: ANCHORS,
  },
];
