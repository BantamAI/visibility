import { db } from "@workspace/lib/db/db";
import { promptRuns, prompts, runMentions } from "@workspace/lib/db/schema";
import type { FidelityTier } from "@workspace/lib/providers";
import { and, eq, gte, inArray, isNotNull, lt, type SQL } from "drizzle-orm";
import { areaCompetitors, localMentions, runLocations, samplePoints } from "../schema";
import { judgedBrand, judgedSentiment, subjectPosition } from "./judged";
import { computeLocalMetrics, type LocalMetrics, type MetricRun, phrasingOf } from "./metrics";

export interface LocalMetricsScope {
	since: Date;
	until: Date;
	/** Every area when left out. */
	areaId?: string;
	model?: string;
	/** Every tier when left out. */
	tiers?: readonly FidelityTier[];
	/** Only runs of these prompts; every prompt when left out. */
	promptIds?: readonly string[];
}

const lower = (name: string) => name.trim().toLowerCase();

interface CountedMention {
	runId: string;
	competitorName: string | null;
	cardPosition: number | null;
}

/** The names of each area's tracked competitors, keyed by their lowercased name. */
function trackedNamesByArea(tracked: readonly { areaId: string; name: string }[]) {
	const byArea = new Map<string, Map<string, string>>();
	for (const { areaId, name } of tracked) {
		const names = byArea.get(areaId) ?? new Map<string, string>();
		names.set(lower(name), name);
		byArea.set(areaId, names);
	}
	return byArea;
}

function metricSubject(
	row: CountedMention | undefined,
	judged: { sentiment: string | null; position: string | null },
): MetricRun["subject"] {
	if (!row) return null;
	return { ...subjectPosition(row.cardPosition, judged.position), sentiment: judgedSentiment(judged.sentiment) };
}

/**
 * The subject's located runs in scope whose local mentions have been matched, with what they count.
 * A run still waiting to be matched is left out rather than counted as not naming anyone.
 * Runs in the caller's subject scope.
 */
export async function loadMetricRuns(subjectId: string, scope: LocalMetricsScope): Promise<MetricRun[]> {
	if (scope.promptIds?.length === 0 || scope.tiers?.length === 0) return [];
	const filters: SQL[] = [
		eq(runLocations.subjectId, subjectId),
		isNotNull(runLocations.localMentionsStamp),
		gte(promptRuns.createdAt, scope.since),
		lt(promptRuns.createdAt, scope.until),
	];
	if (scope.areaId) filters.push(eq(samplePoints.areaId, scope.areaId));
	if (scope.model) filters.push(eq(promptRuns.model, scope.model));
	if (scope.tiers) filters.push(inArray(runLocations.fidelityTier, [...scope.tiers]));
	if (scope.promptIds) filters.push(inArray(promptRuns.promptId, [...scope.promptIds]));
	const where = and(...filters);

	const runsInScope = db
		.select({ runId: runLocations.runId })
		.from(runLocations)
		.innerJoin(samplePoints, eq(samplePoints.id, runLocations.pointId))
		.innerJoin(promptRuns, eq(promptRuns.id, runLocations.runId))
		.where(where);

	const [runs, mentions, tracked] = await Promise.all([
		db
			.select({
				runId: runLocations.runId,
				promptId: promptRuns.promptId,
				model: promptRuns.model,
				areaId: samplePoints.areaId,
				tags: prompts.tags,
				tier: runLocations.fidelityTier,
				createdAt: promptRuns.createdAt,
				sentiment: judgedBrand("sentiment"),
				textPosition: judgedBrand("position"),
			})
			.from(runLocations)
			.innerJoin(samplePoints, eq(samplePoints.id, runLocations.pointId))
			.innerJoin(promptRuns, eq(promptRuns.id, runLocations.runId))
			.innerJoin(prompts, eq(prompts.id, promptRuns.promptId))
			.leftJoin(runMentions, eq(runMentions.runId, runLocations.runId))
			.where(where),
		db
			.select({
				runId: localMentions.runId,
				competitorName: localMentions.competitorName,
				cardPosition: localMentions.cardPosition,
			})
			.from(localMentions)
			.where(
				and(
					eq(localMentions.subjectId, subjectId),
					eq(localMentions.counted, true),
					inArray(localMentions.runId, runsInScope),
				),
			),
		db
			.select({ areaId: areaCompetitors.areaId, name: areaCompetitors.name })
			.from(areaCompetitors)
			.where(and(eq(areaCompetitors.subjectId, subjectId), eq(areaCompetitors.tracked, true))),
	]);

	const trackedByArea = trackedNamesByArea(tracked);
	const mentionsByRun = new Map<string, CountedMention[]>();
	for (const mention of mentions)
		mentionsByRun.set(mention.runId, [...(mentionsByRun.get(mention.runId) ?? []), mention]);

	return runs.map((run) => {
		const counted = mentionsByRun.get(run.runId) ?? [];
		const areaTracked = trackedByArea.get(run.areaId);
		return {
			runId: run.runId,
			promptId: run.promptId,
			model: run.model,
			areaId: run.areaId,
			phrasing: phrasingOf(run.tags),
			tier: run.tier,
			createdAt: run.createdAt,
			subject: metricSubject(
				counted.find((mention) => mention.competitorName === null),
				{ sentiment: run.sentiment, position: run.textPosition },
			),
			competitors: counted.flatMap(({ competitorName }) => {
				const name = competitorName === null ? undefined : areaTracked?.get(lower(competitorName));
				return name ? [name] : [];
			}),
		};
	});
}

/** The subject's local metrics in scope, each on its own (see `computeLocalMetrics`). */
export async function localMetrics(subjectId: string, scope: LocalMetricsScope): Promise<LocalMetrics> {
	return computeLocalMetrics(await loadMetricRuns(subjectId, scope), scope.since, scope.until);
}
