import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDb } from './client.js';
import { products, type ProductRow } from './schema.js';

export const defaultCatalogPath = fileURLToPath(
  new URL('../../../assets/catalog.json', import.meta.url),
);

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

const catalogModel = z.object({
  id: z.number().int().positive(),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  totalWidthMm: z.number().positive(),
  lensWidthMm: z.number().positive(),
  lensHeightMm: z.number().positive(),
  bridgeMm: z.number().positive(),
  templeLengthMm: z.number().positive(),
  dimensionsSource: z.string(),
  bridgeOriginMm: vec3,
  anchors: z.object({
    bridgeCenter: vec3,
    nosePadLeft: vec3,
    nosePadRight: vec3,
    hingeLeft: vec3,
    hingeRight: vec3,
  }),
  attribution: z.object({
    title: z.string(),
    author: z.string(),
    authorUrl: z.string(),
    sourceUrl: z.string(),
    license: z.string(),
    licenseUrl: z.string(),
  }),
});

const catalogFile = z.object({ models: z.array(catalogModel).min(1) });

// The frontend serves assets/out/<slug>.glb under /models (frontend/scripts/vendor-models.mjs).
export const catalogToRows = (raw: unknown): ProductRow[] =>
  catalogFile.parse(raw).models.map((model) => ({
    id: model.id,
    slug: model.slug,
    name: model.name,
    description: model.description,
    category: 'glasses',
    type: 'glasses',
    modelPath: `/models/${model.slug}.glb`,
    dimensionsMm: {
      total: model.totalWidthMm,
      lensWidth: model.lensWidthMm,
      lensHeight: model.lensHeightMm,
      bridge: model.bridgeMm,
      templeLength: model.templeLengthMm,
    },
    dimensionsSource: model.dimensionsSource,
    bridgeOriginMm: model.bridgeOriginMm,
    anchors: model.anchors,
    attribution: {
      title: model.attribution.title,
      author: model.attribution.author,
      authorUrl: model.attribution.authorUrl,
      sourceUrl: model.attribution.sourceUrl,
      license: model.attribution.license,
      licenseUrl: model.attribution.licenseUrl,
    },
  }));

export const seedProducts = async (
  db: AppDb,
  catalogPath = defaultCatalogPath,
): Promise<number> => {
  const rows = catalogToRows(JSON.parse(await readFile(catalogPath, 'utf8')) as unknown);
  await db.transaction(async (tx) => {
    await tx
      .insert(products)
      .values(rows)
      .onConflictDoUpdate({
        target: products.id,
        set: {
          slug: sql`excluded.slug`,
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          category: sql`excluded.category`,
          type: sql`excluded.type`,
          modelPath: sql`excluded.model_path`,
          dimensionsMm: sql`excluded.dimensions_mm`,
          dimensionsSource: sql`excluded.dimensions_source`,
          bridgeOriginMm: sql`excluded.bridge_origin_mm`,
          anchors: sql`excluded.anchors`,
          attribution: sql`excluded.attribution`,
        },
      });
    await tx.delete(products).where(
      notInArray(
        products.id,
        rows.map((row) => row.id),
      ),
    );
  });
  return rows.length;
};
