import { loadConfig } from '../config.js';
import { openDatabase } from '../db/client.js';

const database = await openDatabase(loadConfig().databaseUrl);
try {
  await database.migrate();
} finally {
  await database.close();
}
