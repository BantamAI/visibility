#!/usr/bin/env node

/** Fails when a table in the public schema lacks RLS or a subject_id column (E53-S13). */

import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
	console.error("DATABASE_URL must point at a migrated visibility database.");
	process.exit(2);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
let rows;
try {
	({ rows } = await client.query(`
		SELECT c.relname AS table,
			c.relrowsecurity AS rls,
			EXISTS (
				SELECT 1 FROM pg_attribute a
				WHERE a.attrelid = c.oid AND a.attname = 'subject_id' AND a.attnum > 0 AND NOT a.attisdropped
			) AS has_subject_id
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
		ORDER BY c.relname
	`));
} finally {
	await client.end();
}

const failing = rows.filter((row) => !row.rls || !row.has_subject_id);
for (const row of failing) {
	const missing = [!row.rls && "RLS", !row.has_subject_id && "subject_id"].filter(Boolean).join(" and ");
	console.log(`✗ ${row.table}: missing ${missing}`);
}
console.log(`${rows.length - failing.length}/${rows.length} tables have RLS and subject_id.`);
process.exit(failing.length > 0 ? 1 : 0);
