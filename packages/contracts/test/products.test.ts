import { describe, expect, it } from 'vitest';
import { parseProductId, product, productIdParam, productList } from '../src/index.js';

const PRODUCT = {
  id: 1,
  slug: 'rectangular-acetate',
  name: 'Rectangular Acetate Glasses',
  category: 'glasses',
  type: 'glasses',
  modelPath: '/models/rectangular-acetate.glb',
  description: 'Black rectangular full-rim frame with clear lenses.',
  dimensionsMm: { total: 140, lensWidth: 53, lensHeight: 33, bridge: 18, templeLength: 135 },
  dimensionsSource: 'nominal',
  bridgeOriginMm: [0, 12.2, -2.2],
  anchors: {
    bridgeCenter: [0, 0, 0],
    nosePadLeft: [9, -8, -0.9],
    nosePadRight: [-9, -8, -0.9],
    hingeLeft: [69, 0.5, -6.8],
    hingeRight: [-69, 0.5, -6.8],
  },
  attribution: {
    title: 'Glasses',
    author: 'AlbertVictory',
    authorUrl: 'https://sketchfab.com/albert_victory',
    sourceUrl: 'https://sketchfab.com/3d-models/glasses-4b8a1e54f3084c63828fe8c324198aec',
    license: 'CC-BY-4.0',
    licenseUrl: 'http://creativecommons.org/licenses/by/4.0/',
  },
};

describe('product', () => {
  it('accepts a catalog product and drops keys it does not know', () => {
    const parsed = product.parse({ ...PRODUCT, addedLater: true });
    expect(parsed).toEqual(PRODUCT);
    expect(productList.parse([PRODUCT])).toHaveLength(1);
  });

  it.each([
    ['a javascript: author link', { authorUrl: 'javascript:alert(1)' }],
    ['a data: license link', { licenseUrl: 'data:text/html,hi' }],
    ['a missing title', { title: undefined }],
  ])('rejects %s in the attribution', (_label, change) => {
    const attribution = { ...PRODUCT.attribution, ...change };
    expect(product.safeParse({ ...PRODUCT, attribution }).success).toBe(false);
  });

  it.each([
    ['a model path off /models', { modelPath: 'https://cdn.example/x.glb' }],
    ['a model path with traversal', { modelPath: '/models/../secret.glb' }],
    ['a string id', { id: '1' }],
    ['a short anchor', { anchors: { ...PRODUCT.anchors, bridgeCenter: [0, 0] } }],
    ['another type', { type: 'hat' }],
  ])('rejects %s', (_label, change) => {
    expect(product.safeParse({ ...PRODUCT, ...change }).success).toBe(false);
  });
});

describe('product ids', () => {
  it.each([
    ['1', 1],
    ['42', 42],
    ['2147483647', 2_147_483_647],
  ])('parses %s', (raw, id) => {
    expect(parseProductId(raw)).toBe(id);
    expect(productIdParam.parse({ id: raw })).toEqual({ id });
  });

  it.each([undefined, '', '0', '01', '1.0', '1e2', '0x10', '-1', '2147483648', 'abc', ' 1'])(
    'rejects %s',
    (raw) => {
      expect(parseProductId(raw)).toBeNull();
    },
  );
});
