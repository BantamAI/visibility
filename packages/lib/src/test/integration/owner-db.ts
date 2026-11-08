import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema";

/** The table owner on a plain pool, untouched by tenant scopes: for what only it may do, like TRUNCATE. */
export function createOwnerDb() {
	return drizzle({ connection: process.env.MIGRATION_DATABASE_URL!, schema });
}
