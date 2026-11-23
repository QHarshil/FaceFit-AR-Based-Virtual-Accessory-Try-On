import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '../src/db/client.js';
import { productRepository } from '../src/db/products.js';
import { defaultCatalogPath, seedProducts } from '../src/db/seed.js';

interface CatalogModel {
  id: number;
  slug: string;
  name: string;
  totalWidthMm: number;
  lensWidthMm: number;
  lensHeightMm: number;
  bridgeMm: number;
  templeLengthMm: number;
  anchors: unknown;
  attribution: { author: string; license: string };
}

const catalog = (JSON.parse(readFileSync(defaultCatalogPath, 'utf8')) as { models: CatalogModel[] })
  .models;

describe('seed', () => {
  let database: Database;

  beforeAll(async () => {
    database = await openDatabase('pglite://memory');
    await database.migrate();
  });

  afterAll(async () => {
    await database.close();
  });

  it('stores every catalog model with its dimensions, anchors and attribution', async () => {
    expect(await seedProducts(database.db)).toBe(catalog.length);
    const rows = await productRepository(database.db).list();

    expect(rows.map((row) => row.id)).toEqual(catalog.map((model) => model.id));
    for (const model of catalog) {
      const row = rows.find((candidate) => candidate.id === model.id);
      expect(row?.slug).toBe(model.slug);
      expect(row?.name).toBe(model.name);
      expect(row?.dimensionsMm).toEqual({
        total: model.totalWidthMm,
        lensWidth: model.lensWidthMm,
        lensHeight: model.lensHeightMm,
        bridge: model.bridgeMm,
        templeLength: model.templeLengthMm,
      });
      expect(row?.anchors).toEqual(model.anchors);
      expect(row?.attribution.author).toBe(model.attribution.author);
      expect(row?.attribution.license).toBe(model.attribution.license);
    }
  });

  it('is idempotent', async () => {
    await seedProducts(database.db);
    await seedProducts(database.db);
    expect(await productRepository(database.db).list()).toHaveLength(catalog.length);
  });
});
