import { loadConfig } from '../config.js';
import { openDatabase } from '../db/client.js';
import { defaultCatalogPath, seedProducts } from '../db/seed.js';

const database = await openDatabase(loadConfig().databaseUrl);
try {
  const count = await seedProducts(database.db, process.env['CATALOG_PATH'] ?? defaultCatalogPath);
  process.stdout.write(`${JSON.stringify({ msg: 'seeded', count })}\n`);
} finally {
  await database.close();
}
