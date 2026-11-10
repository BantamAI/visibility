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

async function main() {
	const runs = new Map(set.runs.map((run) => [run.id, run]));
	const pairs = [...new Set(set.items.map((item) => `${item.run}\t${item.judgedAs}`))];
	const predictions = new Map<string, Record<Setup, boolean> & { method: string; probability: number }>();
	await pool(pairs, 8, async (pair) => {
		const [runId, area] = pair.split("\t") as [string, AreaId];
		const run = runs.get(runId);
		if (!run) throw new Error(`No run ${runId}`);
		const [plain, local] = await Promise.all([
			analyzer.analyze(run.text, mentionConfig(area), null, run.prompt),
			analyzer.analyze(run.text, localConfig(area), null, run.prompt),
		]);
		const businesses = tracked(area);
		const { center, radiusMeters } = AREAS[area];
		const near = nearAreaByZip([{ ...center, radiusMeters }], new Map(Object.entries(set.zips)));
		const matches = matchLocalMentions(businesses, run.cards, local.assessments, near);
		for (const business of businesses) {
			const match = matches.find((m) => m.competitorName === business.competitorName);
			predictions.set(`${pair}\t${business.name}`, {
				"Elmo's judge": judged(plain, business),
				"Judge told where": judged(local, business),
				"Cards, then judge told where": match?.counted ?? false,
				method: match ? `${match.method}${match.review ? ` (${match.review})` : ""}` : "none",
				probability:
					(business.competitorName === null
						? local.assessments?.brand?.probability
						: local.assessments?.competitors[business.competitorName]?.probability) ?? 0,
			});
		}
	});

	console.log(`${set.items.length} items from ${set.runs.length} answers\n`);
	console.log("| Setup | Precision | Recall | False positives | False negatives |");
	console.log("|---|---|---|---|---|");
	for (const setup of SETUPS) {
		let tp = 0;
		let fp = 0;
		let fn = 0;
		for (const item of set.items) {
			const predicted = predictions.get(`${item.run}\t${item.judgedAs}\t${item.business}`)?.[setup] ?? false;
			if (predicted && item.mentioned) tp++;
			else if (predicted) fp++;
			else if (item.mentioned) fn++;
		}
		const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "–");
		console.log(`| ${setup} | ${pct(tp, tp + fp)} | ${pct(tp, tp + fn)} | ${fp} | ${fn} |`);
	}

	const methods = new Map<string, { right: number; wrong: number }>();
	console.log("\nWrong under the full match:");
	for (const item of set.items) {
		const prediction = predictions.get(`${item.run}\t${item.judgedAs}\t${item.business}`);
		const counted = prediction?.["Cards, then judge told where"] ?? false;
		const tally = methods.get(prediction?.method ?? "none") ?? { right: 0, wrong: 0 };
		tally[counted === item.mentioned ? "right" : "wrong"]++;
		methods.set(prediction?.method ?? "none", tally);
		if (counted === item.mentioned) continue;
		const run = runs.get(item.run);
		console.log(
			`- ${counted ? "counted" : "missed"}: ${item.business} in a ${run?.area} ${run?.route} answer judged as ${item.judgedAs} (${prediction?.method})${item.note ? `: ${item.note}` : ""}`,
		);
	}
	if (process.env.SHOW_PROBABILITIES) {
		for (const item of set.items) {
			const prediction = predictions.get(`${item.run}\t${item.judgedAs}\t${item.business}`);
			if (prediction?.method.startsWith("text"))
				console.log(
					`P ${item.mentioned ? "yes" : "no "} ${prediction.probability.toFixed(3)} ${item.business} ${item.note}`,
				);
		}
	}
	console.log("\n| Method | Right | Wrong |\n|---|---|---|");
	for (const [method, { right, wrong }] of [...methods].sort()) console.log(`| ${method} | ${right} | ${wrong} |`);
}

await main();
