import { defineConfig } from "vitest/config";
import { asAppRole } from "../lib/src/test/integration/app-role";

export default defineConfig({
	test: {
		projects: [
			{
				test: {
					name: "unit",
					include: ["src/**/*.test.ts"],
					exclude: ["src/**/*.integration.test.ts"],
				},
			},
			{
				test: {
					name: "integration",
					include: ["src/**/*.integration.test.ts"],
					globalSetup: ["../lib/src/test/integration/global-setup.ts"],
					// A vendor stop holds for every subject, so one file's stop would hold up another's scans.
					fileParallelism: false,
					// Its own variable rather than DATABASE_URL, which in a dev checkout
					// points at data these tests would write into.
					env: {
						DATABASE_URL: asAppRole(process.env.TEST_DATABASE_URL),
						MIGRATION_DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
					},
					setupFiles: ["../lib/src/test/integration/agency-scope.ts"],
				},
			},
		],
	},
});
