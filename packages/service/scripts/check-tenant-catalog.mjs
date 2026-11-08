#!/usr/bin/env node

/**
 * Fails when a table in the public schema isn't tenant-safe (E53-S13): it needs RLS,
 * and either subject_id with an index and a visibility_subject policy, or an entry
 * in tenancy.agency_only_tables. The app's login role (E53-S37) may reach a subject
 * table only by switching to visibility_subject or visibility_agency.
 */

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
			EXISTS (SELECT 1 FROM tenancy.agency_only_tables t WHERE t.table_name = c.oid) AS agency_only,
			a.attnum IS NOT NULL AS has_subject_id,
			EXISTS (
				SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum
			) AS has_subject_index,
			EXISTS (
				SELECT 1 FROM pg_policy p
				WHERE p.polrelid = c.oid AND 'visibility_subject'::regrole = ANY (p.polroles)
			) AS has_subject_policy,
			has_table_privilege('visibility_app', c.oid, 'SELECT, INSERT, UPDATE, DELETE') AS app_reaches
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		LEFT JOIN pg_attribute a
			ON a.attrelid = c.oid AND a.attname = 'subject_id' AND a.attnum > 0 AND NOT a.attisdropped
		WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
		ORDER BY c.relname
	`));
} finally {
	await client.end();
}

function problems(row) {
	const missing = [];
	if (!row.rls) missing.push("RLS");
	if (row.agency_only) return missing;
	if (!row.has_subject_id) missing.push("subject_id");
	if (!row.has_subject_index) missing.push("an index on subject_id");
	if (!row.has_subject_policy) missing.push("a visibility_subject policy");
	return missing;
}

let failing = 0;
for (const row of rows) {
	const missing = problems(row);
	const appReaches = row.app_reaches && !row.agency_only;
	if (missing.length > 0) {
		const hint = row.agency_only ? "" : " (or register it with tenancy.restrict_to_agency)";
		console.log(`✗ ${row.table}: missing ${missing.join(", ")}${hint}`);
	}
	if (appReaches) console.log(`✗ ${row.table}: visibility_app reaches it without switching to a tenancy role`);
	if (missing.length > 0 || appReaches) failing++;
}
const agencyOnly = rows.filter((row) => row.agency_only).length;
console.log(
	`${rows.length - failing}/${rows.length} tables are tenant-safe (${rows.length - agencyOnly} subject-scoped, ${agencyOnly} agency-only).`,
);
process.exit(failing > 0 ? 1 : 0);
