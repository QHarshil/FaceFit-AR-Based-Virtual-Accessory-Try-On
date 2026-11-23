import { asc, eq } from 'drizzle-orm';
import type { AppDb } from './client.js';
import { products, type ProductRow } from './schema.js';

export type Product = ProductRow;

export interface ProductRepository {
  list(): Promise<Product[]>;
  find(id: number): Promise<Product | undefined>;
}

export const productRepository = (db: AppDb): ProductRepository => ({
  list: () => db.select().from(products).orderBy(asc(products.id)),
  find: async (id) => (await db.select().from(products).where(eq(products.id, id)).limit(1))[0],
});
