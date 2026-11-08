import pg from "pg";

const TEST_APP_PASSWORD = "visibility_app";

/** The same test database, reached as the app's login role rather than the owner. */
export function asAppRole(ownerUrl: string | undefined): string {
	if (!ownerUrl) return "";
	const url = new URL(ownerUrl);
	url.username = "visibility_app";
	url.password = TEST_APP_PASSWORD;
	return url.toString();
}

/** Roles are cluster-wide, so this also sets the password other databases on the server see. */
export async function enableAppLogin(ownerUrl: string): Promise<void> {
	const client = new pg.Client({ connectionString: ownerUrl });
	await client.connect();
	try {
		await client.query(`ALTER ROLE visibility_app WITH LOGIN PASSWORD '${TEST_APP_PASSWORD}'`);
	} finally {
		await client.end();
	}
}
