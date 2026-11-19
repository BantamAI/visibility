import type { Sentiment } from "@workspace/lib/mentions";
import type { FidelityTier } from "@workspace/lib/providers";
import { CITY_NAMED_TAG } from "../prompt-templates/templates";
import { NEAR_ME_TAG } from "../run-planner/constants";
import { type Proportion, wilsonInterval } from "./interval";

export const FIDELITY_TIERS: readonly FidelityTier[] = ["T1", "T2", "T3", "T4", "T5"];

/** How a prompt places the asker: "near me", a named city, or neither (a prompt written by hand). */
export type Phrasing = "near-me" | "city-named" | "other";

export function phrasingOf(tags: readonly string[]): Phrasing {
	if (tags.includes(NEAR_ME_TAG)) return "near-me";
	if (tags.includes(CITY_NAMED_TAG)) return "city-named";
	return "other";
}

/** One located answer whose local mentions have been matched. */
export interface MetricRun {
	runId: string;
	promptId: string;
	model: string;
	areaId: string;
	phrasing: Phrasing;
	tier: FidelityTier;
	createdAt: Date;
	/** Null when the answer doesn't count a mention of the subject. */
	subject: {
		/** The matched card's position, else where the judge ranks it among tracked businesses named; null when neither. */
		position: number | null;
		positionFrom: "card" | "text" | null;
		sentiment: Sentiment | null;
	} | null;
	/** The tracked competitors of the run's area that the answer counts. */
	competitors: readonly string[];
}

export interface RateRow extends Proportion {
	key: string;
}

/** The share of answers counting the subject, with its Wilson 95% interval, per value of `key`; most answers first. */
export function mentionRates(runs: readonly MetricRun[], key: (run: MetricRun) => string): RateRow[] {
	const groups = new Map<string, { mentioned: number; runs: number }>();
	for (const run of runs) {
		const group = groups.get(key(run)) ?? { mentioned: 0, runs: 0 };
		group.runs++;
		if (run.subject) group.mentioned++;
		groups.set(key(run), group);
	}
	return [...groups]
		.map(([k, group]) => ({ key: k, ...wilsonInterval(group.mentioned, group.runs) }))
		.sort((a, b) => b.trials - a.trials || a.key.localeCompare(b.key));
}

export const mentionRate = (runs: readonly MetricRun[]) =>
	wilsonInterval(runs.filter((run) => run.subject).length, runs.length);

export interface ShareOfVoice {
	/** Answers counting the subject. */
	subjectMentions: number;
	/** Subject mentions plus each tracked competitor's, one per answer. */
	totalMentions: number;
	/** Null when no one is mentioned. */
	share: number | null;
	competitors: { name: string; mentions: number; share: number }[];
}

/** Elmo's share of voice: the subject's mentions over everyone's, counting only competitors tracked in each run's area. */
export function shareOfVoice(runs: readonly MetricRun[]): ShareOfVoice {
	let subjectMentions = 0;
	const competitorMentions = new Map<string, number>();
	for (const run of runs) {
		if (run.subject) subjectMentions++;
		for (const name of new Set(run.competitors)) competitorMentions.set(name, (competitorMentions.get(name) ?? 0) + 1);
	}
	const totalMentions = subjectMentions + [...competitorMentions.values()].reduce((sum, n) => sum + n, 0);
	return {
		subjectMentions,
		totalMentions,
		share: totalMentions === 0 ? null : subjectMentions / totalMentions,
		competitors: [...competitorMentions]
			.map(([name, mentions]) => ({ name, mentions, share: mentions / totalMentions }))
			.sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name)),
	};
}

export interface AveragePosition {
	/** Null when no answer ranks the subject. */
	average: number | null;
	/** Answers counting the subject that rank it. */
	ranked: number;
	/** Of those, the answers ranking it by a card. */
	byCard: number;
}

export function averagePosition(runs: readonly MetricRun[]): AveragePosition {
	let sum = 0;
	let ranked = 0;
	let byCard = 0;
	for (const { subject } of runs) {
		if (subject?.position == null) continue;
		sum += subject.position;
		ranked++;
		if (subject.positionFrom === "card") byCard++;
	}
	return { average: ranked === 0 ? null : sum / ranked, ranked, byCard };
}

export interface SentimentBreakdown {
	/** Answers counting the subject. */
	mentions: number;
	/** Of those, the answers the judge gave a sentiment. */
	judged: number;
	counts: Record<Sentiment, number>;
	/** Share of judged answers that are positive, with its interval. */
	positive: Proportion;
}

export function sentimentBreakdown(runs: readonly MetricRun[]): SentimentBreakdown {
	const counts: Record<Sentiment, number> = { positive: 0, neutral: 0, negative: 0, mixed: 0 };
	let mentions = 0;
	for (const { subject } of runs) {
		if (!subject) continue;
		mentions++;
		if (subject.sentiment) counts[subject.sentiment]++;
	}
	const judged = counts.positive + counts.neutral + counts.negative + counts.mixed;
	return { mentions, judged, counts, positive: wilsonInterval(counts.positive, judged) };
}

/** How far one tier's share of a week's answers must move from the last week with answers to mark the trend. */
export const TIER_MIX_SHIFT = 0.2;

const WEEK_MS = 7 * 86_400_000;
/** A Monday, so weeks run Monday to Sunday, UTC. */
const WEEK_ORIGIN = Date.UTC(2024, 0, 1);

export const weekStart = (date: Date) =>
	new Date(WEEK_ORIGIN + Math.floor((date.getTime() - WEEK_ORIGIN) / WEEK_MS) * WEEK_MS);

export interface TrendPoint extends Proportion {
	weekStart: Date;
	tiers: Record<FidelityTier, number>;
	/** The week's tier mix differs from the last week with answers, so its rate isn't measured the same way. */
	tierMixChanged: boolean;
}

const emptyTiers = (): Record<FidelityTier, number> => ({ T1: 0, T2: 0, T3: 0, T4: 0, T5: 0 });

export function tierMixShifted(before: Record<FidelityTier, number>, after: Record<FidelityTier, number>): boolean {
	const total = (tiers: Record<FidelityTier, number>) => FIDELITY_TIERS.reduce((sum, tier) => sum + tiers[tier], 0);
	const beforeTotal = total(before);
	const afterTotal = total(after);
	if (beforeTotal === 0 || afterTotal === 0) return false;
	return FIDELITY_TIERS.some(
		(tier) => Math.abs(after[tier] / afterTotal - before[tier] / beforeTotal) >= TIER_MIX_SHIFT - 1e-9,
	);
}

/** Weekly mention rate over [since, until), every week included, with the tiers behind each. */
export function mentionTrend(runs: readonly MetricRun[], since: Date, until: Date): TrendPoint[] {
	const weeks = new Map<number, { mentioned: number; runs: number; tiers: Record<FidelityTier, number> }>();
	for (let week = weekStart(since).getTime(); week < until.getTime(); week += WEEK_MS)
		weeks.set(week, { mentioned: 0, runs: 0, tiers: emptyTiers() });
	for (const run of runs) {
		const week = weeks.get(weekStart(run.createdAt).getTime());
		if (!week) continue;
		week.runs++;
		week.tiers[run.tier]++;
		if (run.subject) week.mentioned++;
	}
	let previous: Record<FidelityTier, number> | null = null;
	return [...weeks].map(([week, { mentioned, runs: count, tiers }]) => {
		const tierMixChanged = previous !== null && count > 0 && tierMixShifted(previous, tiers);
		if (count > 0) previous = tiers;
		return { weekStart: new Date(week), ...wilsonInterval(mentioned, count), tiers, tierMixChanged };
	});
}

export interface LocalMetrics {
	mentionRate: Proportion;
	byEngine: RateRow[];
	byArea: RateRow[];
	byPhrasing: RateRow[];
	shareOfVoice: ShareOfVoice;
	position: AveragePosition;
	sentiment: SentimentBreakdown;
	trend: TrendPoint[];
	/** Answers per tier in scope, so a reader sees what the figures rest on. */
	tiers: Record<FidelityTier, number>;
}

/** Each metric on its own; ADR-32 rules out blending them into one score. */
export function computeLocalMetrics(runs: readonly MetricRun[], since: Date, until: Date): LocalMetrics {
	const tiers = emptyTiers();
	for (const run of runs) tiers[run.tier]++;
	return {
		mentionRate: mentionRate(runs),
		byEngine: mentionRates(runs, (run) => run.model),
		byArea: mentionRates(runs, (run) => run.areaId),
		byPhrasing: mentionRates(runs, (run) => run.phrasing),
		shareOfVoice: shareOfVoice(runs),
		position: averagePosition(runs),
		sentiment: sentimentBreakdown(runs),
		trend: mentionTrend(runs, since, until),
		tiers,
	};
}
