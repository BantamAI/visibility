/**
 * Scores local matching against the hand-labelled eval set, calling Jev for real:
 *
 *   pnpm exec tsx --env-file=../../.env scripts/local-matching-eval/run.ts
 *
 * Three setups are compared on the same answers: the judge as Elmo asks it (name and website
 * only), the judge told where each business is, and the full match (cards first, then that judge).
 * Prints precision and recall for each, and every item the full match gets wrong.
 */
import { readFileSync } from "node:fs";
import { createMentionAnalyzer, type RunMentions } from "@workspace/lib/mention-judge";
import type { MentionConfig } from "@workspace/lib/mentions";
import { describeWhereabouts, localizeMentionConfig } from "../../src/local/local-mentions/context";
import { matchLocalMentions, type TrackedBusiness } from "../../src/local/local-mentions/match";
import { nearAreaByZip } from "../../src/local/local-mentions/near";
import { AREAS, type AreaId, type EvalSet } from "./config";

const set: EvalSet = JSON.parse(readFileSync(new URL("./dataset.json", import.meta.url), "utf8"));
const analyzer = createMentionAnalyzer(process.env.TYPESAFE_API_KEY, () => process.env.OPENROUTER_API_KEY);

function tracked(area: AreaId): TrackedBusiness[] {
	return AREAS[area].businesses.map((business) => {
		const anchor = set.anchors[`${area}|${business.name}`];
		return {
			competitorName: business.subject ? null : business.name,
			name: business.name,
			aliases: business.aliases,
			websites: [],
			placeId: anchor?.placeId ?? null,
			cid: anchor?.cid ?? null,
			phone: null,
		};
	});
}

function mentionConfig(area: AreaId): MentionConfig {
	const [subject, ...competitors] = tracked(area);
	const plain = (business: TrackedBusiness) => ({ name: business.name, aliases: business.aliases, domains: [] });
	return { brand: plain(subject), competitors: competitors.map(plain) };
}

function localConfig(area: AreaId): MentionConfig {
	const whereabouts = describeWhereabouts([AREAS[area].whereabouts], undefined);
	return localizeMentionConfig(mentionConfig(area), { subject: whereabouts, competitors: new Map() });
}

type Setup = "Elmo's judge" | "Judge told where" | "Cards, then judge told where";
const SETUPS: Setup[] = ["Elmo's judge", "Judge told where", "Cards, then judge told where"];

const judged = (mentions: RunMentions, business: TrackedBusiness) =>
	business.competitorName === null
		? !!mentions.assessments?.brand?.mentioned
		: !!mentions.assessments?.competitors[business.competitorName]?.mentioned;

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	await Promise.all(
		Array.from({ length: size }, async () => {
			while (next < items.length) await work(items[next++]);
		}),
	);
}

type Prediction = Record<Setup, boolean> & { method: string };
type Item = EvalSet["items"][number];

const keyOf = (item: Item) => `${item.run}\t${item.judgedAs}\t${item.business}`;

/** Judges one answer as one area's would be, under every setup. */
async function predict(run: EvalSet["runs"][number], area: AreaId): Promise<[string, Prediction][]> {
	const [plain, local] = await Promise.all([
		analyzer.analyze(run.text, mentionConfig(area), null, run.prompt),
		analyzer.analyze(run.text, localConfig(area), null, run.prompt),
	]);
	const businesses = tracked(area);
	const { center, radiusMeters } = AREAS[area];
	const near = nearAreaByZip([{ ...center, radiusMeters }], new Map(Object.entries(set.zips)));
	const matches = matchLocalMentions(businesses, run.cards, local.assessments, near);
	return businesses.map((business) => {
		const match = matches.find((m) => m.competitorName === business.competitorName);
		const prediction: Prediction = {
			"Elmo's judge": judged(plain, business),
			"Judge told where": judged(local, business),
			"Cards, then judge told where": match?.counted ?? false,
			method: match ? `${match.method}${match.review ? ` (${match.review})` : ""}` : "none",
		};
		return [`${run.id}\t${area}\t${business.name}`, prediction];
	});
}

function printScores(predictions: Map<string, Prediction>): void {
	console.log("| Setup | Precision | Recall | False positives | False negatives |");
	console.log("|---|---|---|---|---|");
	const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "–");
	for (const setup of SETUPS) {
		const outcomes = set.items.map((item) => ({ item, predicted: predictions.get(keyOf(item))?.[setup] ?? false }));
		const tp = outcomes.filter(({ item, predicted }) => predicted && item.mentioned).length;
		const fp = outcomes.filter(({ item, predicted }) => predicted && !item.mentioned).length;
		const fn = outcomes.filter(({ item, predicted }) => !predicted && item.mentioned).length;
		console.log(`| ${setup} | ${pct(tp, tp + fp)} | ${pct(tp, tp + fn)} | ${fp} | ${fn} |`);
	}
}

function printErrors(predictions: Map<string, Prediction>, runs: Map<string, EvalSet["runs"][number]>): void {
	const methods = new Map<string, { right: number; wrong: number }>();
	console.log("\nWrong under the full match:");
	for (const item of set.items) {
		const prediction = predictions.get(keyOf(item));
		const method = prediction?.method ?? "none";
		const right = (prediction?.["Cards, then judge told where"] ?? false) === item.mentioned;
		const tally = methods.get(method) ?? { right: 0, wrong: 0 };
		tally[right ? "right" : "wrong"]++;
		methods.set(method, tally);
		if (right) continue;
		const run = runs.get(item.run);
		const note = item.note ? `: ${item.note}` : "";
		console.log(
			`- ${item.mentioned ? "missed" : "counted"}: ${item.business} in a ${run?.area} ${run?.route} answer judged as ${item.judgedAs} (${method})${note}`,
		);
	}
	console.log("\n| Method | Right | Wrong |\n|---|---|---|");
	for (const [method, { right, wrong }] of [...methods].sort()) console.log(`| ${method} | ${right} | ${wrong} |`);
}

async function main() {
	const runs = new Map(set.runs.map((run) => [run.id, run]));
	const pairs = [...new Set(set.items.map((item) => `${item.run}\t${item.judgedAs}`))];
	const predictions = new Map<string, Prediction>();
	await pool(pairs, 8, async (pair) => {
		const [runId, area] = pair.split("\t") as [string, AreaId];
		const run = runs.get(runId);
		if (!run) throw new Error(`No run ${runId}`);
		for (const [key, prediction] of await predict(run, area)) predictions.set(key, prediction);
	});
	console.log(`${set.items.length} items from ${set.runs.length} answers\n`);
	printScores(predictions);
	printErrors(predictions, runs);
}

await main();
