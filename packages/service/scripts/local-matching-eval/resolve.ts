/**
 * Lists the businesses each eval answer names with the extraction LLM, and looks up on Google the
 * names that could be a tracked business of the area each answer is judged as, the way the
 * `resolve-named-businesses` job does. Kept in `named.json`, so a rerun only calls for what's new:
 *
 *   pnpm exec tsx --env-file=../../.env scripts/local-matching-eval/resolve.ts
 *
 * One LLM call per answer and one Text Search (about $0.035) per name and area. Only Place IDs
 * and CIDs are kept from Google.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runStructuredCompletionPrompt } from "@workspace/lib/onboarding";
import { extractionPrompt, namedBusinessesFrom, namedBusinessesSchema } from "../../src/local/named-businesses/extract";
import { startsWithName } from "../../src/local/named-businesses/names";
import { pickCandidate, searchQuery } from "../../src/local/named-businesses/resolve";
import { googlePlacesProvider } from "../../src/providers/places/google";
import { AREAS, type AreaId, type EvalSet, type NamedSet, resolutionKey } from "./config";

const HERE = new URL(".", import.meta.url).pathname;
const NAMED = `${HERE}named.json`;

/** Whether a name could be one of the area's tracked businesses, the only names matching reads. */
const couldBeTracked = (area: AreaId, name: string) =>
	AREAS[area].businesses.some((business) =>
		[business.name, ...business.aliases].some((term) => startsWithName(name, term)),
	);

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	await Promise.all(
		Array.from({ length: size }, async () => {
			while (next < items.length) await work(items[next++]);
		}),
	);
}

async function main() {
	const set: EvalSet = JSON.parse(readFileSync(`${HERE}dataset.json`, "utf8"));
	const named: NamedSet = existsSync(NAMED)
		? JSON.parse(readFileSync(NAMED, "utf8"))
		: { extractions: {}, resolutions: {} };
	const save = () => writeFileSync(NAMED, `${JSON.stringify(named, null, "\t")}\n`);

	const unlisted = set.runs.filter((run) => !named.extractions[run.id]);
	await pool(unlisted, 4, async (run) => {
		const { object } = await runStructuredCompletionPrompt(extractionPrompt(run.text), namedBusinessesSchema);
		named.extractions[run.id] = namedBusinessesFrom(object);
	});
	save();
	console.log(`Listed ${unlisted.length} answer(s)`);

	const key = process.env.GOOGLE_PLACES_API_KEY;
	if (!key) throw new Error("GOOGLE_PLACES_API_KEY is needed to look names up");
	const places = googlePlacesProvider(key);
	const pairs = [...new Set(set.items.map((item) => `${item.run}\t${item.judgedAs}`))];
	let looked = 0;
	for (const pair of pairs) {
		const [runId, area] = pair.split("\t") as [string, AreaId];
		const { center, radiusMeters } = AREAS[area];
		const circle = { ...center, radiusMeters };
		for (const business of named.extractions[runId] ?? []) {
			const resolution = resolutionKey(area, business);
			if (named.resolutions[resolution] || !couldBeTracked(area, business.name)) continue;
			const { data } = await places.searchText(searchQuery(business), circle);
			named.resolutions[resolution] = pickCandidate(business.name, business.phone, data, [circle]);
			looked++;
		}
	}
	save();
	console.log(`Looked up ${looked} name(s)`);
}

await main();
