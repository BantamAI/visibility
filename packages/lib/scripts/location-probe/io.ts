import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROBE_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT_DIR = resolve(PROBE_DIR, "out");
const REPO_ROOT = resolve(PROBE_DIR, "../../../..");

/** Real env vars win over .env entries. */
export async function loadDotEnv(path = resolve(REPO_ROOT, ".env")): Promise<void> {
	let contents: string;
	try {
		contents = await readFile(path, "utf8");
	} catch {
		return;
	}
	for (const line of contents.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq < 0) continue;
		const key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		if (process.env[key] === undefined && value) process.env[key] = value;
	}
}

export async function readJsonl<T>(path: string): Promise<T[]> {
	let contents: string;
	try {
		contents = await readFile(path, "utf8");
	} catch {
		return [];
	}
	return contents
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as T);
}

export async function appendJsonl(path: string, row: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await appendFile(path, `${JSON.stringify(row)}\n`);
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as T;
	} catch {
		return fallback;
	}
}

export async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** At most `limit` tasks in flight, so one slow vendor can't stall the rest. */
export async function forEachLimited<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>) {
	let next = 0;
	const worker = async () => {
		while (next < items.length) await task(items[next++]);
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export interface RunRow {
	key: string;
	phase: "screen" | "main" | "grid";
	route: string;
	engine: string;
	provider: string;
	subject: string;
	point: string;
	promptId: string;
	rep: number;
	prompt: string;
	ranAt: string;
	latencyMs: number;
	ok: boolean;
	text: string | null;
	citations: { url: string; title?: string }[];
	/** Map, local-pack or business cards came back alongside the answer. */
	cards: boolean;
	estUsd: number;
	/** What the vendor's response says it billed, when it says. */
	vendorUsd?: number;
	/** The placed request as sent, without credentials. */
	sent?: { url: string; body: unknown };
	error?: string;
	rawOutput?: unknown;
}
