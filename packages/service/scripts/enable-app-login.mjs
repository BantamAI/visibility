#!/usr/bin/env node

/**
 * Lets visibility_app log in with the password DATABASE_URL carries (E53-S37). Runs
 * after migrations, connected as the owner through MIGRATION_DATABASE_URL, so
 * rotating the password means changing DATABASE_URL and redeploying.
 */

import pg from "pg";

const ownerUrl = process.env.MIGRATION_DATABASE_URL;
const appUrl = process.env.DATABASE_URL;

if (!ownerUrl) {
	console.log("MIGRATION_DATABASE_URL is unset, so DATABASE_URL is still the owner; visibility_app left as it is.");
	process.exit(0);
}
if (!appUrl) {
	console.error("DATABASE_URL must point at the database as visibility_app.");
	process.exit(2);
}

const { username, password } = new URL(appUrl);
if (decodeURIComponent(username) !== "visibility_app" || !password) {
	console.error("DATABASE_URL must connect as visibility_app with a password.");
	process.exit(2);
}

const client = new pg.Client({ connectionString: ownerUrl });
await client.connect();
try {
	await client.query(`ALTER ROLE visibility_app WITH LOGIN PASSWORD ${client.escapeLiteral(decodeURIComponent(password))}`);
} finally {
	await client.end();
}
console.log("visibility_app can log in.");
