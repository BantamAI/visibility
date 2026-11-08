import { defineConfig } from "drizzle-kit";
export default defineConfig({
	schema: ["./src/db/schema.ts", "./src/db/schema-auth.ts", "../service/src/local/schema.ts"],
	out: "./src/db/migrations",
	dialect: "postgresql",
	dbCredentials: {
		// The app's DATABASE_URL can't run DDL once it's the visibility_app role (E53-S37).
		url: (process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL)!,
	},
});
