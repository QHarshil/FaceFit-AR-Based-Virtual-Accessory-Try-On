import './zodConfig.js';
import { z } from 'zod';

export const MAX_PRODUCT_ID = 2_147_483_647;

export const productId = z.number().int().positive().max(MAX_PRODUCT_ID);

// A digit-only string keeps "1e2", "0x10" and "1.0" from coercing to a valid id.
export const productIdParam = z.strictObject({
  id: z
    .string()
    .regex(/^[1-9]\d{0,9}$/)
    .transform(Number)
    .pipe(productId),
});

/** The numeric id in a route or path segment, or null when it is not a valid product id. */
export const parseProductId = (raw: string | undefined): number | null => {
  const parsed = productIdParam.safeParse({ id: raw });
  return parsed.success ? parsed.data.id : null;
};

export const noQuery = z.strictObject({});

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

// Rendered as links, so only http and https are allowed.
const webUrl = z.url({ protocol: /^https?$/ });

/** Points in the model's frame, in millimetres (see assets/README.md). */
export const productAnchors = z.object({
  bridgeCenter: vec3,
  nosePadLeft: vec3,
  nosePadRight: vec3,
  hingeLeft: vec3,
  hingeRight: vec3,
});

export const productDimensions = z.object({
  total: z.number().positive(),
  lensWidth: z.number().positive(),
  lensHeight: z.number().positive(),
  bridge: z.number().positive(),
  templeLength: z.number().positive(),
});

/** Credit for a CC BY model: title, author and license, each with a link. */
export const attribution = z.object({
  title: z.string().min(1),
  author: z.string().min(1),
  authorUrl: webUrl,
  sourceUrl: webUrl,
  license: z.string().min(1),
  licenseUrl: webUrl,
});

// Responses use z.object, which drops keys it does not know, so the backend
// can add a field before the frontend reads it.
export const product = z.object({
  id: productId,
  slug: z.string().min(1),
  name: z.string().min(1),
  category: z.string(),
  type: z.literal('glasses'),
  modelPath: z.string().regex(/^\/models\/[a-z0-9-]+\.glb$/),
  description: z.string(),
  dimensionsMm: productDimensions,
  dimensionsSource: z.string(),
  bridgeOriginMm: vec3,
  anchors: productAnchors,
  attribution,
});

export const productList = z.array(product);

export const apiError = z.object({
  error: z.string(),
  requestId: z.string().optional(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

export type ProductAnchors = z.infer<typeof productAnchors>;
export type ProductDimensions = z.infer<typeof productDimensions>;
export type Attribution = z.infer<typeof attribution>;
export type Product = z.infer<typeof product>;
export type ApiError = z.infer<typeof apiError>;
