#!/usr/bin/env tsx
/**
 * SP5-L scorer: reads out/runs.jsonl, names the businesses in each answer and where
 * it says the user is, places both on Google Maps, and writes out/report.md and
 * out/summary.json with each route's numbers.
 *
 *   pnpm --filter @workspace/lib location-probe:score
 *
 * Needs ANTHROPIC_API_KEY (naming) and SEARCHAPI_API_KEY (Maps). Every lookup is
 * cached in out/, so rescoring after a rule change costs nothing.
 */
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { structuredResearch } from "../../src/providers/registry/ai-sdk";
import { GRID_SPACING_MILES, getSubject, gridPoints, type Point, SUBJECTS, spokePoints } from "./areas";
import { DEFAULT_OUT_DIR, forEachLimited, loadDotEnv, type RunRow, readJson, readJsonl, writeJson } from "./io";
import { getPrompt } from "./prompts";
import { ROUTES, type Route } from "./routes";
import {
	type Business,
	businessKey,
	distanceCanary,
	inAreaShare,
	isPlaced,
	jaccard,
	keysOf,
	type LatLng,
	mean,
	median,
	milesBetween,
	nameMatchesPlace,
	percentile,
	pointOverlapByDistance,
	repeatOverlap,
	type ScoredAnswer,
	shareFoundIn,
} from "./scoring";

const { values: args } = parseArgs({ options: { out: { type: "string", default: DEFAULT_OUT_DIR } } });

const NAMING_MODEL = "claude-haiku-5-5";
const LOOKUP_CONCURRENCY = 6;
const REFERENCE_ROUTE = "google-ai-mode:dataforseo";
/** Below this, between-point overlap is no lower than chance would make it. */
const POINT_SENSITIVITY_MARGIN = 0.1;

const ALL_POINTS = new Map<string, Point>(
	SUBJECTS.flatMap((subject) => [...spokePoints(subject), ...gridPoints(subject)]).map((p) => [p.id, p]),
);
const pointAt = (id: string): Point => {
	const point = ALL_POINTS.get(id);
	if (!point) throw new Error(`Unknown point ${id}`);
	return point;
};

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

async function cachedLookups<T, R>({
	label,
	items,
	key,
	cachePath,
	lookUp,
}: {
	label: string;
	items: readonly T[];
	key: (item: T) => string;
	cachePath: string;
	lookUp: (item: T) => Promise<R>;
}): Promise<Map<string, R>> {
	const cache = await readJson<Record<string, R>>(cachePath, {});
	const pending = [...new Map(items.map((item) => [key(item), item])).values()].filter((item) => !(key(item) in cache));
	if (pending.length > 0) {
		console.log(`${label}: ${pending.length} lookups...`);
		const failures: string[] = [];
		let done = 0;
		await forEachLimited(pending, LOOKUP_CONCURRENCY, async (item) => {
			try {
				cache[key(item)] = await lookUp(item);
			} catch (error) {
				failures.push(error instanceof Error ? error.message : String(error));
			}
			if (++done % 100 === 0) await writeJson(cachePath, cache);
		});
		await writeJson(cachePath, cache);
		if (failures.length > 0) {
			throw new Error(`${failures.length} ${label} lookups failed (the rest are cached; rerun). First: ${failures[0]}`);
		}
	}
	return new Map(Object.entries(cache));
}

const READING_SCHEMA = z.object({
	businesses: z.array(z.string()),
	statedUserLocation: z.string().nullable(),
});
type Reading = z.infer<typeof READING_SCHEMA>;

function readingPrompt(text: string): string {
	return `Below is an answer an AI assistant gave to a question about plumbers or about where the user is.

1. List every specific business the answer names as a provider of plumbing work, using the trading name exactly as written. Leave out directories and platforms (Yelp, Angi, HomeAdvisor, Thumbtack, Google, Nextdoor, the BBB), manufacturers, and generic advice such as "a licensed local plumber". Use an empty list if it names none.
2. If the answer says or clearly assumes where the user is (for example "based on your location in Gilbert, Arizona", "plumbers in the Raleigh area", or "you appear to be in Denver"), give that place as "City, ST" (or "ST" for a state alone). Use null if it doesn't, or if it only lists several regions without picking one.

<answer>
${text}
</answer>`;
}

interface MapsPlace {
	title?: string;
	place_id?: string;
	data_id?: string;
	gps_coordinates?: { latitude: number; longitude: number };
}

async function searchMaps(q: string, at: LatLng, zoom: number): Promise<MapsPlace[]> {
	const params = new URLSearchParams({ engine: "google_maps", q, ll: `@${at.latitude},${at.longitude},${zoom}z` });
	const res = await fetch(`https://www.searchapi.io/api/v1/search?${params}`, {
		headers: { Authorization: `Bearer ${process.env.SEARCHAPI_API_KEY}` },
	});
	if (!res.ok) throw new Error(`SearchApi maps "${q}" failed: ${res.status}`);
	const body = (await res.json()) as { local_results?: MapsPlace[]; place_result?: MapsPlace };
	return body.local_results ?? (body.place_result ? [body.place_result] : []);
}

type Placed = { placeId?: string; latitude?: number; longitude?: number };

function toPlaced(place: MapsPlace | undefined): Placed {
	const gps = place?.gps_coordinates;
	return gps ? { placeId: place.place_id ?? place.data_id, latitude: gps.latitude, longitude: gps.longitude } : {};
}

interface Latest {
	row: RunRow;
	/** Every attempt of this run failed. */
	failed: boolean;
}

function latestByKey(rows: readonly RunRow[]): Latest[] {
	const byKey = new Map<string, Latest>();
	for (const row of rows) {
		const prior = byKey.get(row.key);
		if (prior && !prior.failed) continue;
		byKey.set(row.key, { row, failed: !row.ok });
	}
	return [...byKey.values()];
}

const pct = (value: number | null) => (value === null ? "–" : `${Math.round(value * 100)}%`);
const num = (value: number | null, digits = 1) => (value === null ? "–" : value.toFixed(digits));
const cell = (text: string) => text.replaceAll("|", "/").replace(/\s+/g, " ");

interface RouteSummary {
	phase: "screen" | "main";
	route: string;
	engine: string;
	claimedTier: string;
	grid: string;
	method: string;
	attempted: number;
	answered: number | null;
	namesBusinesses: number | null;
	canaryPass: number | null;
	canaryJudged: number;
	inAreaShare: number | null;
	medianMiles: number | null;
	statedCorrect: number | null;
	statedCount: number;
	statedTop: string;
	mapsReferenceShare: number | null;
	t1Overlap: number | null;
	repeatOverlap: number | null;
	pointOverlap: number | null;
	pointSensitive: boolean | null;
	cityNamedCanaryPass: number | null;
	cards: number | null;
	p50Seconds: number | null;
	p95Seconds: number | null;
	usdPerRun: number | null;
	usdSource: "vendor" | "estimate";
}

interface Lookups {
	readingOf: (row: RunRow) => Reading;
	businessesOf: (row: RunRow) => Business[];
	scored: (row: RunRow) => ScoredAnswer;
	statedPlaces: Map<string, Placed>;
	references: Map<string, string[]>;
	reference: Map<string, ScoredAnswer>;
}

const fraction = <T>(items: readonly T[], test: (item: T) => boolean) =>
	items.length ? items.filter(test).length / items.length : null;
const present = <T>(values: readonly (T | null)[]) => values.filter((v): v is T => v !== null);

function canaryPass(rows: readonly RunRow[], ctx: Lookups) {
	const judged = rows
		.map((row) => distanceCanary(pointAt(row.point), ctx.businessesOf(row), getSubject(row.subject).radiusMiles))
		.filter((c) => c !== "no-businesses");
	return { pass: fraction(judged, (c) => c === "pass"), judged: judged.length };
}

function statedStats(rows: readonly RunRow[], ctx: Lookups) {
	const stated = rows
		.map((row) => ({ row, place: ctx.readingOf(row).statedUserLocation }))
		.filter((s): s is { row: RunRow; place: string } => !!s.place);
	const verdicts = present(
		stated.map(({ row, place }) => {
			const at = ctx.statedPlaces.get(place.toLowerCase());
			if (at?.latitude === undefined || at.longitude === undefined) return null;
			const miles = milesBetween(pointAt(row.point), { latitude: at.latitude, longitude: at.longitude });
			return miles <= getSubject(row.subject).radiusMiles * 1.5;
		}),
	);
	const counts = new Map<string, number>();
	for (const { place } of stated) counts.set(place, (counts.get(place) ?? 0) + 1);
	const top = [...counts]
		.sort(([, a], [, b]) => b - a)
		.slice(0, 4)
		.map(([place, count]) => `${place} ×${count}`)
		.join(", ");
	return { correct: fraction(verdicts, Boolean), count: stated.length, top };
}

function overlapStats(route: Route, phase: string, nearMe: readonly RunRow[], ctx: Lookups) {
	const t1 =
		route.id === REFERENCE_ROUTE
			? []
			: present(
					nearMe.map((row) => {
						const ref = ctx.reference.get(`${phase}|${row.point}|${row.promptId}|${row.rep}`);
						return ref ? jaccard(keysOf(ctx.businessesOf(row)), keysOf(ref.businesses)) : null;
					}),
				);
	const scored = nearMe.map(ctx.scored);
	const repeats = repeatOverlap(scored);
	const across = route.grid === "coordinate" ? (pointOverlapByDistance(scored, pointAt, () => 0).get(0) ?? null) : null;
	return {
		t1Overlap: mean(t1),
		repeatOverlap: repeats,
		pointOverlap: across,
		pointSensitive: repeats !== null && across !== null ? across < repeats - POINT_SENSITIVITY_MARGIN : null,
		mapsReferenceShare: mean(
			present(nearMe.map((row) => shareFoundIn(ctx.businessesOf(row), new Set(ctx.references.get(row.point) ?? [])))),
		),
	};
}

function summarizeRoute(route: Route, phase: "screen" | "main", latest: readonly Latest[], ctx: Lookups): RouteSummary {
	const mine = latest.filter((l) => l.row.route === route.id && l.row.phase === phase);
	const ok = mine.filter((l) => !l.failed).map((l) => l.row);
	const nearMe = ok.filter((row) => getPrompt(row.promptId).kind === "near-me");
	const cityNamed = ok.filter((row) => getPrompt(row.promptId).kind === "city-named");
	const radius = (row: RunRow) => getSubject(row.subject).radiusMiles;
	const canary = canaryPass(nearMe, ctx);
	const stated = statedStats(ok, ctx);
	const vendorCosts = ok.map((row) => row.vendorUsd).filter((c): c is number => typeof c === "number");
	const latencies = ok.map((row) => row.latencyMs / 1000);
	return {
		phase,
		route: route.id,
		engine: route.engine,
		claimedTier: route.claimedTier,
		grid: route.grid,
		method: route.method,
		attempted: mine.length,
		answered: mine.length ? ok.length / mine.length : null,
		namesBusinesses: fraction(nearMe, (row) => ctx.readingOf(row).businesses.length > 0),
		canaryPass: canary.pass,
		canaryJudged: canary.judged,
		inAreaShare: mean(
			present(nearMe.map((row) => inAreaShare(pointAt(row.point), ctx.businessesOf(row), radius(row)))),
		),
		medianMiles: median(
			nearMe.flatMap((row) =>
				ctx
					.businessesOf(row)
					.filter(isPlaced)
					.map((b) => milesBetween(pointAt(row.point), b)),
			),
		),
		statedCorrect: stated.correct,
		statedCount: stated.count,
		statedTop: stated.top,
		...overlapStats(route, phase, nearMe, ctx),
		cityNamedCanaryPass: canaryPass(cityNamed, ctx).pass,
		cards: fraction(ok, (row) => row.cards),
		p50Seconds: percentile(latencies, 0.5),
		p95Seconds: percentile(latencies, 0.95),
		usdPerRun: vendorCosts.length ? mean(vendorCosts) : route.estUsdPerRun,
		usdSource: vendorCosts.length ? "vendor" : "estimate",
	};
}

async function main() {
	await loadDotEnv();
	const rows = await readJsonl<RunRow>(resolve(args.out, "runs.jsonl"));
	const latest = latestByKey(rows);
	const answered = latest.filter((l) => !l.failed).map((l) => l.row);

	const anthropicKey = process.env.ANTHROPIC_API_KEY;
	if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY is needed to read the answers");
	if (!process.env.SEARCHAPI_API_KEY) throw new Error("SEARCHAPI_API_KEY is needed for Maps lookups");
	const model = createAnthropic({ apiKey: anthropicKey })(NAMING_MODEL);

	const texts = answered.map((row) => row.text ?? "").filter((text) => text.trim());
	const readings = await cachedLookups<string, Reading>({
		label: "Reading answers",
		items: texts,
		key: hash,
		cachePath: resolve(args.out, "readings-cache.json"),
		lookUp: (text) => structuredResearch(model, { prompt: readingPrompt(text), schema: READING_SCHEMA }),
	});
	const readingOf = (row: RunRow): Reading =>
		row.text?.trim()
			? (readings.get(hash(row.text)) ?? { businesses: [], statedUserLocation: null })
			: { businesses: [], statedUserLocation: null };

	type NameNeed = { subject: string; name: string };
	const nameNeeds: NameNeed[] = answered.flatMap((row) =>
		readingOf(row).businesses.map((name) => ({ subject: row.subject, name: name.trim() })),
	);
	const places = await cachedLookups<NameNeed, Placed>({
		label: "Placing businesses",
		items: nameNeeds,
		key: (need) => `${need.subject}|${need.name.toLowerCase()}`,
		cachePath: resolve(args.out, "places-cache.json"),
		lookUp: async (need) => {
			const [top] = await searchMaps(need.name, getSubject(need.subject).center, 11);
			return top?.title && nameMatchesPlace(need.name, top.title) ? toPlaced(top) : {};
		},
	});

	const stated = answered.map((row) => readingOf(row).statedUserLocation).filter((s): s is string => !!s);
	const statedPlaces = await cachedLookups<string, Placed>({
		label: "Placing stated locations",
		items: stated,
		key: (s) => s.toLowerCase(),
		cachePath: resolve(args.out, "stated-cache.json"),
		lookUp: async (s) => toPlaced((await searchMaps(s, { latitude: 39.8, longitude: -98.6 }, 4))[0]),
	});

	const referencePoints = [...new Set(answered.map((row) => row.point))];
	const references = await cachedLookups<string, string[]>({
		label: "Maps reference lists",
		items: referencePoints,
		key: (id) => id,
		cachePath: resolve(args.out, "reference-cache.json"),
		lookUp: async (id) =>
			(await searchMaps("plumber", pointAt(id), 13)).map((p) =>
				businessKey({ name: p.title ?? "", placeId: p.place_id }),
			),
	});

	const businessesOf = (row: RunRow): Business[] =>
		readingOf(row).businesses.map((name) => ({
			name,
			...(places.get(`${row.subject}|${name.trim().toLowerCase()}`) ?? {}),
		}));
	const scored = (row: RunRow): ScoredAnswer => ({
		route: row.route,
		phase: row.phase,
		subject: row.subject,
		point: row.point,
		promptId: row.promptId,
		rep: row.rep,
		businesses: businessesOf(row),
	});

	const reference = new Map<string, ScoredAnswer>(
		answered
			.filter((row) => row.route === REFERENCE_ROUTE)
			.map((row) => [`${row.phase}|${row.point}|${row.promptId}|${row.rep}`, scored(row)]),
	);

	const ctx: Lookups = { readingOf, businessesOf, scored, statedPlaces, references, reference };
	const routeIds = new Set(latest.map((l) => l.row.route));
	const summarize = (phase: "screen" | "main") =>
		ROUTES.filter((route) => routeIds.has(route.id)).map((route) => summarizeRoute(route, phase, latest, ctx));
	const screen = summarize("screen");
	const summaries = summarize("main");

	const gridLines = gridReport(
		latest.filter((l) => !l.failed && l.row.phase === "grid").map((l) => l.row),
		scored,
	);
	const calibration = answered
		.filter((row) => row.phase !== "grid" && row.promptId === "C1")
		.sort((a, b) => a.route.localeCompare(b.route) || a.point.localeCompare(b.point));

	const failures = latest.filter((l) => l.failed);
	const lines = [
		"# SP5-L location probe report",
		"",
		`Scored ${new Date().toISOString().slice(0, 10)} from ${rows.length} rows (${answered.length} answered runs, ${failures.length} runs that never answered).`,
		"",
		"## Screen",
		"",
		"Every route first answers N1, N2 and the calibration prompt from each subject's center (and calibration from every spoke on coordinate routes), one repeat. Only routes that pass get the full run.",
		"",
		...routeTable(screen),
		"",
		"## Full run",
		"",
		"Near-me prompts (N1–N5) decide. **Canary** is E53-S27's distance rule: an answer passes when the median distance from the point asked from to the businesses it names, placed on Google Maps, is within the subject's radius (10 miles for the metros, 6 for Naperville). **Stated** is where the answer says the user is, checked against the point (within 1.5× the radius). **Maps ref** is the share of an answer's businesses that Google Maps also lists for \"plumber\" at that point. **T1 overlap** is Jaccard against DataForSEO AI Mode for the same point, prompt and repeat. **Points vs repeats** compares overlap between different points with overlap between repeats at one point: a route that really uses the point overlaps less across points.",
		"",
		...routeTable(summaries),
		"\\* estimate from the vendor's published price; the rest are what the vendor's response says it billed.",
		"",
		"## Where answers said the user was",
		"",
		"| Route | Places named (most common first) |",
		"| --- | --- |",
		...summaries.map((s) => `| ${s.route} | ${cell(s.statedTop) || "–"} |`),
		"",
		'## Calibration: "what city am I in right now?"',
		"",
		"| Route | Point | Answer |",
		"| --- | --- | --- |",
		...calibration.map(
			(row) => `| ${row.route} | ${row.point} | ${cell((row.text ?? "").slice(0, 160)) || "(empty)"} |`,
		),
		"",
		...gridLines,
		"## Runs that never answered",
		"",
		...(failures.length === 0
			? ["None."]
			: summarizeFailures(failures.map((l) => l.row)).map((line) => `- ${cell(line)}`)),
		"",
	];
	await writeFile(resolve(args.out, "report.md"), lines.join("\n"));
	await writeJson(resolve(args.out, "summary.json"), summaries);
	console.log(`Wrote ${resolve(args.out, "report.md")}`);
}

function routeTable(rows: readonly RouteSummary[]): string[] {
	if (rows.length === 0) return ["No runs yet."];
	return [
		"| Route | Tier hoped | Answered | Names a business | Canary pass (n) | In-area share | Median miles | Stated correct (n) | Maps ref | T1 overlap | Points vs repeats | City-named canary | Cards | p50 / p95 s | $/run |",
		"| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
		...rows
			.map((s) =>
				[
					s.route,
					s.claimedTier,
					`${pct(s.answered)} of ${s.attempted}`,
					pct(s.namesBusinesses),
					`${pct(s.canaryPass)} (${s.canaryJudged})`,
					pct(s.inAreaShare),
					num(s.medianMiles),
					`${pct(s.statedCorrect)} (${s.statedCount})`,
					pct(s.mapsReferenceShare),
					pct(s.t1Overlap),
					s.pointOverlap === null
						? "–"
						: `${pct(s.pointOverlap)} vs ${pct(s.repeatOverlap)}${s.pointSensitive ? " ✓" : ""}`,
					pct(s.cityNamedCanaryPass),
					pct(s.cards),
					`${num(s.p50Seconds, 0)} / ${num(s.p95Seconds, 0)}`,
					`$${num(s.usdPerRun, 4)}${s.usdSource === "estimate" ? "*" : ""}`,
				].join(" | "),
			)
			.map((line) => `| ${line} |`),
		"",
	];
}

function summarizeFailures(rows: readonly RunRow[]): string[] {
	const byReason = new Map<string, number>();
	for (const row of rows) {
		const reason = `${row.route}: ${(row.error ?? "unknown").slice(0, 160)}`;
		byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
	}
	return [...byReason].sort(([, a], [, b]) => b - a).map(([reason, count]) => `${count} × ${reason}`);
}

function gridReport(rows: readonly RunRow[], scored: (row: RunRow) => ScoredAnswer): string[] {
	if (rows.length === 0) return [];
	const lines = [
		"## Grid sensitivity (Raleigh, 5×5, 3 miles apart)",
		"",
		"Mean Jaccard overlap between answers to the same prompt and repeat from two grid points, by distance between the points, against overlap between repeats at one point. If 3-mile neighbours overlap about as much as repeats do, a coarser grid loses nothing.",
		"",
		"| Route | Repeats | 3 mi | ~4 mi | 6 mi | ~7–9 mi | 12+ mi |",
		"| --- | --- | --- | --- | --- | --- | --- |",
	];
	const bucket = (miles: number) => {
		const steps = miles / GRID_SPACING_MILES;
		if (steps < 1.2) return 1;
		if (steps < 1.6) return 1.4;
		if (steps < 2.1) return 2;
		if (steps < 3.1) return 3;
		return 4;
	};
	for (const routeId of [...new Set(rows.map((row) => row.route))]) {
		const answers = rows.filter((row) => row.route === routeId).map(scored);
		const byDistance = pointOverlapByDistance(answers, pointAt, bucket);
		const at = (b: number) => pct(byDistance.get(b) ?? null);
		lines.push(
			`| ${routeId} | ${pct(repeatOverlap(answers))} | ${at(1)} | ${at(1.4)} | ${at(2)} | ${at(3)} | ${at(4)} |`,
		);
	}
	lines.push("");
	return lines;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
