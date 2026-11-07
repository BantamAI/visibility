import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseDotenv } from "dotenv";
import { CONFIG_HOME, fileExists } from "../config.js";
import { log } from "./ui.js";

export interface LoadedEnv {
	loaded: boolean;
}

/**
 * Load the provider keys + SCRAPE_TARGETS that `chatspy init` wrote, so the `lab`
 * commands can reach the same providers the deployment uses. Values are merged
 * into `process.env` **without** clobbering anything already exported in the
 * shell (ambient env wins; the file fills the gaps), because provider
 * implementations read their keys lazily from `process.env`.
 *
 * Resolution: `--dir` if given, else `~/.elmo`. With an explicit `--dir` that
 * has no `.env` we throw; with the default we silently fall back to the ambient
 * environment so users who export keys themselves can still run the commands.
 *
 * This never reads or requires `DATABASE_URL` — the lab commands never touch a
 * database.
 */
export async function loadElmoEnv(explicitDir?: string): Promise<LoadedEnv> {
	const dir = explicitDir ? path.resolve(process.cwd(), explicitDir) : CONFIG_HOME;
	const envPath = path.join(dir, ".env");

	if (!(await fileExists(envPath))) {
		if (explicitDir) {
			throw new Error(
				`No .env found at ${envPath}. Run \`chatspy init --dir ${explicitDir}\` first, or export the provider keys yourself.`,
			);
		}
		log.warn(`No ChatSpy config found at ${envPath}; using the current environment for provider keys.`);
		return { loaded: false };
	}

	const contents = await fs.readFile(envPath, "utf8");
	const values = parseDotenv(contents);
	for (const [key, value] of Object.entries(values)) {
		if (process.env[key] === undefined) {
			process.env[key] = value;
		}
	}
	return { loaded: true };
}
