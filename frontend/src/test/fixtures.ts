import type { Product, ProductAnchors } from '../types';

// Product 1's anchors in assets/catalog.json.
export const ANCHORS: ProductAnchors = {
  bridgeCenter: [0, 0, 0],
  nosePadLeft: [9, -8, -0.9],
  nosePadRight: [-9, -8, -0.9],
  hingeLeft: [69, 0.5, -6.8],
  hingeRight: [-69, 0.5, -6.8],
};

const DIMENSIONS = { total: 140, lensWidth: 53, lensHeight: 33, bridge: 18, templeLength: 135 };

export const PRODUCTS: Product[] = [
  {
    id: 1,
    slug: 'rectangular-acetate',
    name: 'Aviator Glasses',
    category: 'glasses',
    type: 'glasses',
    modelPath: '/models/rectangular-acetate.glb',
    description: 'Classic aviator style glasses',
    dimensionsMm: DIMENSIONS,
    dimensionsSource: 'nominal',
    bridgeOriginMm: [0, 12.2, -2.2],
    anchors: ANCHORS,
    attribution: {
      title: 'Glasses',
      author: 'AlbertVictory',
      authorUrl: 'https://sketchfab.com/albert_victory',
      sourceUrl: 'https://sketchfab.com/3d-models/glasses-4b8a1e54f3084c63828fe8c324198aec',
      license: 'CC-BY-4.0',
      licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    },
  },
  {
    id: 2,
    slug: 'oval-wire-sunglasses',
    name: 'Round Glasses',
    category: 'glasses',
    type: 'glasses',
    modelPath: '/models/oval-wire-sunglasses.glb',
    description: 'Vintage round frame glasses',
    dimensionsMm: DIMENSIONS,
    dimensionsSource: 'nominal',
    bridgeOriginMm: [0, 12.2, -2.2],
    anchors: ANCHORS,
    attribution: {
      title: 'Ray Ban Glasses',
      author: 'Agha.Najam',
      authorUrl: 'https://sketchfab.com/Agha.Najam',
      sourceUrl: 'https://sketchfab.com/3d-models/ray-ban-glasses-bb3a3736110a41bdacc9f92e11831a41',
      license: 'CC-BY-4.0',
      licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
    },
  },
];
