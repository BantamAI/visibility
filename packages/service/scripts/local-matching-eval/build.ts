/**
 * Builds the local matching eval set from the SP5-L bake-off's stored answers (gitignored, see
 * `packages/lib/scripts/location-probe/`): a sample of each area's answers, their text and cards as
 * the product reads them, and every tracked business each answer names under its own area's config
 * and under another's. The labels it proposes are a starting point: each one is checked by hand.
 *
 *   pnpm exec tsx --env-file=../../.env scripts/local-matching-eval/build.ts <path to runs.jsonl>
 *
 * Anchors are found with Places Text Search (about $0.035 each) and kept in `anchors.json`, so a
 * rebuild searches only for businesses added since. Only Place IDs and CIDs are kept. The cards'
 * ZIPs are placed from the `ref_us_zctas` table of the database at MIGRATION_DATABASE_URL.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { wholeWordPattern } from "@workspace/lib/mentions";
import { extractorFor, extractRun } from "@workspace/lib/text-extraction";
import pg from "pg";
import { parseAnswerBusinesses } from "../../src/local/answer-businesses/parse";
import { zipOf } from "../../src/local/local-mentions/near";
import { googlePlacesProvider } from "../../src/providers/places/google";
import { AREAS, type AreaId, type EvalSet } from "./config";

const HERE = new URL(".", import.meta.url).pathname;
const ANCHORS = `${HERE}anchors.json`;
const DATASET = `${HERE}dataset.json`;

/** Per area, how many answers to take from each route. */
const SAMPLE: Record<string, number> = {
	"google-ai-mode:dataforseo": 9,
	"google-ai-overview:dataforseo": 4,
	"claude:anthropic-api": 4,
	"gemini:cloro": 2,
};

/** Each area's answers are also judged as another area's would be, for same-named businesses elsewhere. */
const ALSO_JUDGED_AS: Record<AreaId, AreaId[]> = {
	raleigh: ["denver", "naperville"],
	denver: ["raleigh"],
	naperville: ["denver"],
};

interface ProbeRun {
	key: string;
	phase: string;
	route: string;
	engine: string;
	provider: string;
	subject: AreaId;
	promptId: string;
	prompt: string;
	ok: boolean;
	text: string | null;
	rawOutput: unknown;
}

const hash = (value: string) => createHash("sha1").update(value).digest("hex");

async function anchors(): Promise<EvalSet["anchors"]> {
	const found: EvalSet["anchors"] = existsSync(ANCHORS) ? JSON.parse(readFileSync(ANCHORS, "utf8")) : {};
	const key = process.env.GOOGLE_PLACES_API_KEY;
	for (const area of Object.values(AREAS)) {
		for (const business of area.businesses) {
			const id = `${area.id}|${business.name}`;
			if (found[id]) continue;
			if (!key) throw new Error(`GOOGLE_PLACES_API_KEY is needed to anchor ${id}`);
			const { data } = await googlePlacesProvider(key).searchText(business.search, {
				lat: area.center.lat,
				lng: area.center.lng,
				radiusMeters: area.radiusMeters,
			});
			const pick = data[0];
			if (!pick) throw new Error(`Google found nothing for ${business.search}`);
			console.log(`${id}: ${pick.name}, ${pick.address} (${pick.placeId})`);
			found[id] = { placeId: pick.placeId, cid: pick.cid };
		}
	}
	writeFileSync(ANCHORS, `${JSON.stringify(found, null, "\t")}\n`);
	return found;
}

function sample(runs: ProbeRun[]): ProbeRun[] {
	const taken: ProbeRun[] = [];
	for (const area of Object.keys(AREAS) as AreaId[]) {
		for (const [route, count] of Object.entries(SAMPLE)) {
			const pool = runs
				.filter((run) => run.subject === area && run.route === route)
				.sort((a, b) => hash(a.key).localeCompare(hash(b.key)));
			// Spread over prompts before taking a second answer to any one.
			const byPrompt = new Map<string, ProbeRun[]>();
			for (const run of pool) byPrompt.set(run.promptId, [...(byPrompt.get(run.promptId) ?? []), run]);
			const rounds = [...byPrompt.values()];
			for (let i = 0; taken.filter((t) => t.subject === area && t.route === route).length < count; i++) {
				const next = rounds.map((round) => round[i]).filter(Boolean);
				if (next.length === 0) break;
				taken.push(...next.slice(0, count - taken.filter((t) => t.subject === area && t.route === route).length));
			}
		}
	}
	return taken;
}

async function zipPoints(zips: string[]): Promise<EvalSet["zips"]> {
	const client = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
	await client.connect();
	try {
		const { rows } = await client.query<{ zcta: string; lat: number; lng: number }>(
			"SELECT zcta, lat, lng FROM ref_us_zctas WHERE zcta = ANY($1) ORDER BY zcta",
			[[...new Set(zips)]],
		);
		return Object.fromEntries(rows.map(({ zcta, lat, lng }) => [zcta, { lat, lng }]));
	} finally {
		await client.end();
	}
}

const names = (business: { name: string; aliases: string[] }) =>
	[business.name, ...business.aliases].map((term) => wholeWordPattern(term));

type Item = EvalSet["items"][number];
type Run = EvalSet["runs"][number];

/** Every tracked business the answer names, as each area that judges it tracks them. */
function itemsFor(run: Run, labelled: Map<string, Item>): Item[] {
	return [run.area, ...ALSO_JUDGED_AS[run.area]].flatMap((judgedAs) =>
		AREAS[judgedAs].businesses.flatMap((business) => {
			const patterns = names(business);
			const named =
				patterns.some((pattern) => pattern.test(run.text)) ||
				run.cards.some((card) => card.placement === "answer" && patterns.some((pattern) => pattern.test(card.name)));
			if (!named) return [];
			const proposed = {
				run: run.id,
				judgedAs,
				business: business.name,
				mentioned: judgedAs === run.area,
				note: "proposed",
			};
			return [labelled.get(`${run.id}|${judgedAs}|${business.name}`) ?? proposed];
		}),
	);
}

function asRead(run: ProbeRun): Run | null {
	const text = extractRun(run.rawOutput, extractorFor({ provider: run.provider, model: run.engine })).textContent;
	if (!text) return null;
	const cards = parseAnswerBusinesses(run.rawOutput, run.provider).map(
		({ placement, position, name, placeId, cid, phone, website, address }) => ({
			placement,
			position,
			name,
			placeId,
			cid,
			phone,
			website,
			address,
		}),
	);
	return { id: run.key, area: run.subject, route: run.route, prompt: run.prompt, text, cards };
}

async function main() {
	const source = process.argv[2];
	if (!source) throw new Error("Pass the path to the bake-off's runs.jsonl");
	const runs = readFileSync(source, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as ProbeRun)
		.filter((run) => run.ok && run.phase === "main" && run.promptId !== "C1" && run.text);
	const existing: EvalSet | null = existsSync(DATASET) ? JSON.parse(readFileSync(DATASET, "utf8")) : null;
	const labelled = new Map(existing?.items.map((item) => [`${item.run}|${item.judgedAs}|${item.business}`, item]));

	const read = sample(runs).flatMap((run) => asRead(run) ?? []);
	const set: EvalSet = {
		anchors: await anchors(),
		zips: await zipPoints(read.flatMap((run) => run.cards.flatMap((card) => zipOf(card.address) ?? []))),
		runs: read,
		items: read.flatMap((run) => itemsFor(run, labelled)),
	};
	writeFileSync(DATASET, `${JSON.stringify(set, null, "\t")}\n`);
	console.log(`${set.runs.length} answers, ${set.items.length} items`);
}

await main();
