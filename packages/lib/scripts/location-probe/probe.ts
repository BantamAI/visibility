#!/usr/bin/env tsx
/**
 * SP5-L location probe: asks every candidate route the plumbing prompts from each
 * subject's sample points and appends every answer to out/runs.jsonl.
 *
 *   pnpm --filter @workspace/lib location-probe:run --dry-run
 *   pnpm --filter @workspace/lib location-probe:run --smoke
 *   pnpm --filter @workspace/lib location-probe:run --phases main,grid --budget-usd 40
 *
 * Reruns skip answers already collected, so retrying failures costs only the failures.
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { getProvider } from "../../src/providers";
import type { ProviderOptions } from "../../src/providers/types";
import { extractRun } from "../../src/text-extraction";
import { getSubject, runLocation } from "./areas";
import { appendJsonl, DEFAULT_OUT_DIR, forEachLimited, loadDotEnv, type RunRow, readJsonl } from "./io";
import { installPlacement, withPlacement } from "./place";
import { DEFAULT_SUBJECTS, estimate, type Phase, type PlannedRun, planRuns, runKey } from "./plan";
import { getRoute, ROUTES, type Route } from "./routes";

const { values: args } = parseArgs({
	options: {
		routes: { type: "string" },
		subjects: { type: "string" },
		prompts: { type: "string" },
		phases: { type: "string", default: "main" },
		reps: { type: "string", default: "2" },
		"cloro-reps": { type: "string", default: "1" },
		"cloro-city-named": { type: "boolean", default: false },
		"budget-usd": { type: "string", default: "10" },
		"budget-credits": { type: "string", default: "500" },
		out: { type: "string", default: DEFAULT_OUT_DIR },
		"dry-run": { type: "boolean", default: false },
		smoke: { type: "boolean", default: false },
		concurrency: { type: "string", default: "4" },
	},
});

function positive(flag: string, value: string | undefined): number {
	const parsed = Number(value);
	if (!(parsed > 0)) throw new Error(`--${flag} must be a positive number, got "${value}"`);
	return parsed;
}

const list = (value: string | undefined) =>
	value
		?.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);

const NO_OVERVIEW = /no AI Overview/i;
const DFS_NO_OVERVIEW_TEXT = "No AI overview content found.";

/** Google shows no AI Overview on many searches: an answer naming nobody, not a failure to pay for again. */
function isMissingOverview(route: Route, text: string | null, error?: unknown) {
	if (route.engine !== "google-ai-overview") return false;
	if (error) return error instanceof Error && NO_OVERVIEW.test(error.message);
	return text === null || text === DFS_NO_OVERVIEW_TEXT;
}

const CARD_MARKERS = [
	'"type":"local_pack"',
	'"type":"map"',
	'"type":"chat_gpt_local_businesses"',
	'"is_map":true',
	'"local_results":[{',
	'"places":[{',
	'"map":[{',
];

function hasCards(raw: unknown): boolean {
	const json = JSON.stringify(raw ?? null);
	return CARD_MARKERS.some((marker) => json.includes(marker));
}

/** DataForSEO puts what it billed at the top of each response. */
function vendorUsd(raw: unknown): number | undefined {
	const cost = (raw as { cost?: unknown } | null)?.cost;
	return typeof cost === "number" ? cost : undefined;
}

function providerOptions(run: PlannedRun): ProviderOptions {
	const options: ProviderOptions = { webSearch: true };
	if (run.route.claimedTier === "T4") return { ...options, location: runLocation(run.point), locationTier: "T4" };
	return options;
}

async function runOne(run: PlannedRun): Promise<Omit<RunRow, keyof ReturnType<typeof baseRow>>> {
	const started = Date.now();
	const location = runLocation(run.point);
	try {
		const { result, sent } = await withPlacement(run.route, location, () =>
			getProvider(run.route.provider).run(run.route.engine, run.text, providerOptions(run)),
		);
		const { textContent, citations } = extractRun(result.rawOutput, run.route.provider);
		const missing = isMissingOverview(run.route, textContent);
		const text = missing ? "" : textContent;
		return {
			latencyMs: Date.now() - started,
			ok: text !== null,
			text,
			citations,
			cards: hasCards(result.rawOutput),
			vendorUsd: vendorUsd(result.rawOutput) ?? result.costUsd,
			sent,
			rawOutput: result.rawOutput,
			...(text === null ? { error: "no answer text" } : {}),
		};
	} catch (error) {
		if (isMissingOverview(run.route, null, error)) {
			return { latencyMs: Date.now() - started, ok: true, text: "", citations: [], cards: false };
		}
		return {
			latencyMs: Date.now() - started,
			ok: false,
			text: null,
			citations: [],
			cards: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function baseRow(run: PlannedRun) {
	return {
		key: runKey(run),
		phase: run.phase,
		route: run.route.id,
		engine: run.route.engine,
		provider: run.route.provider,
		subject: run.point.subject,
		point: run.point.id,
		promptId: run.prompt.id,
		rep: run.rep,
		prompt: run.text,
		ranAt: new Date().toISOString(),
		estUsd: run.route.estUsdPerRun,
	};
}

/** One near-me run per route from Raleigh's center, to prove every vendor takes its location fields. */
function smokeRuns(routes: readonly Route[], done: ReadonlySet<string>): PlannedRun[] {
	return planRuns({
		phases: ["main"],
		routes,
		subjects: ["raleigh"],
		prompts: ["N2"],
		reps: () => 1,
		cityNamedOnCloro: false,
		done,
	}).filter((run) => run.point.id === "raleigh-c");
}

function printEstimate(routes: readonly Route[], runs: readonly PlannedRun[], collected: number) {
	const total = estimate(runs);
	console.log(
		`${runs.length} runs to make (${collected} already collected), about $${total.usd.toFixed(2)} and ${total.credits} Cloro credits:`,
	);
	for (const route of routes) {
		const mine = runs.filter((run) => run.route.id === route.id);
		if (mine.length === 0) continue;
		const cost = estimate(mine);
		const ready = getProvider(route.provider).isConfigured() ? "" : "  (no API key set)";
		const credits = cost.credits > 0 ? `  ${cost.credits} credits` : "";
		console.log(
			`  ${route.id.padEnd(30)} ${String(mine.length).padStart(4)} runs  $${cost.usd.toFixed(2)}${credits}${ready}`,
		);
	}
}

async function main() {
	await loadDotEnv();
	installPlacement();

	const routes = list(args.routes)?.map(getRoute) ?? ROUTES;
	const subjects = list(args.subjects) ?? DEFAULT_SUBJECTS;
	for (const subject of subjects) getSubject(subject);
	const phases = (list(args.phases) ?? ["main"]) as Phase[];
	const reps = positive("reps", args.reps);
	const cloroReps = positive("cloro-reps", args["cloro-reps"]);
	const budgetUsd = positive("budget-usd", args["budget-usd"]);
	const budgetCredits = positive("budget-credits", args["budget-credits"]);
	const concurrency = positive("concurrency", args.concurrency);
	const runsPath = resolve(args.out, "runs.jsonl");

	const previous = await readJsonl<RunRow>(runsPath);
	const done = new Set(previous.filter((row) => row.ok).map((row) => row.key));
	const runs = args.smoke
		? smokeRuns(routes, done)
		: planRuns({
				phases,
				routes,
				subjects,
				prompts: list(args.prompts),
				reps: (route) => (route.provider === "cloro" ? cloroReps : reps),
				cityNamedOnCloro: args["cloro-city-named"] ?? false,
				done,
			});
	const total = estimate(runs);
	printEstimate(routes, runs, done.size);
	if (total.usd > budgetUsd || total.credits > budgetCredits) {
		console.error(
			`Over budget ($${budgetUsd}, ${budgetCredits} credits). Narrow the run or raise --budget-usd / --budget-credits.`,
		);
		process.exit(1);
	}
	if (args["dry-run"]) return;

	const missing = routes.filter((route) => !getProvider(route.provider).isConfigured());
	if (missing.length > 0) throw new Error(`No API key for: ${missing.map((r) => r.id).join(", ")}`);

	let finished = 0;
	let failed = 0;
	await forEachLimited(runs, concurrency, async (run) => {
		const row: RunRow = { ...baseRow(run), ...(await runOne(run)) };
		await appendJsonl(runsPath, row);
		if (!row.ok) {
			failed++;
			if (args.smoke || failed <= 5) console.warn(`  ${row.route} ${row.point} ${row.promptId}: ${row.error}`);
		}
		finished++;
		if (args.smoke)
			console.log(`  ${row.route}: ${row.ok ? `ok, ${row.text?.length ?? 0} chars, ${row.latencyMs} ms` : "failed"}`);
		else if (finished % 25 === 0 || finished === runs.length)
			console.log(`  ${finished}/${runs.length} (${failed} failed)`);
	});

	console.log(`Wrote ${runsPath}. Rerun the same command to retry the ${failed} failures.`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
