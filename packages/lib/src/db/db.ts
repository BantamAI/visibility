import { drizzle } from "drizzle-orm/node-postgres";
import type { PoolConfig } from "pg";
import * as schema from "./schema";
import { TenantPool } from "./tenant-pool";

export function createDb(url: string, config?: PoolConfig) {
	return drizzle({
		client: new TenantPool({
			connectionString: url,
			connectionTimeoutMillis: 15_000,
			idleTimeoutMillis: 5_000,
			...config,
		}),
		schema,
	});
}

export const db = createDb(process.env.DATABASE_URL!);
