import { PgBoss } from "pg-boss";

let boss: PgBoss | undefined;

// Built on first use rather than at import so startup env validation runs first.
export function getBoss(): PgBoss {
	boss ??= new PgBoss({
		connectionString: process.env.DATABASE_URL,
		schema: "pgboss",
		// The migrations create it, owned by the app role, which can't create schemas.
		createSchema: false,
		maintenanceIntervalSeconds: 30,
	});
	return boss;
}
