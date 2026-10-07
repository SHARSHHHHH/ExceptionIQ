/** Recreate the demo database from fixtures. Usage: npm run seed */
import { resetDemoDatabase } from '../src/db';
import { config } from '../src/config';
resetDemoDatabase();
console.log(`Seeded demo database at ${config.databasePath}`);
