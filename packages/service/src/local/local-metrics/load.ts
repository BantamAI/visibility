import { db } from "@workspace/lib/db/db";
import { promptRuns, prompts, runMentions } from "@workspace/lib/db/schema";
import type { Sentiment } from "@workspace/lib/mentions";
import type { FidelityTier } from "@workspace/lib/providers";
import { and, eq, gte, inArray, isNotNull, lt, type SQL, sql } from "drizzle-orm";
import { areaCompetitors, localMentions, runLocations, samplePoints } from "../schema";
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

const SENTIMENTS = new Set<string>(["positive", "neutral", "negative", "mixed"]);

const lower = (name: string) => name.trim().toLowerCase();

/** The judge's reading of the subject, when it judged the answer to mention it. */
const judgedBrand = (field: string) =>
	sql<string | null>`CASE WHEN (${runMentions.assessments}->'brand'->>'mentioned')::boolean THEN ${runMentions.assessments}->'brand'->>${field} END`;

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

	const trackedByArea = new Map<string, Map<string, string>>();
	for (const { areaId, name } of tracked) {
		const names = trackedByArea.get(areaId) ?? new Map<string, string>();
		names.set(lower(name), name);
		trackedByArea.set(areaId, names);
	}
	const mentionsByRun = new Map<string, typeof mentions>();
	for (const mention of mentions) mentionsByRun.set(mention.runId, [...(mentionsByRun.get(mention.runId) ?? []), mention]);

	return runs.map((run) => {
		const counted = mentionsByRun.get(run.runId) ?? [];
		const subjectRow = counted.find((mention) => mention.competitorName === null);
		const areaTracked = trackedByArea.get(run.areaId);
		const competitors = counted.flatMap(({ competitorName }) => {
			const name = competitorName === null ? undefined : areaTracked?.get(lower(competitorName));
			return name ? [name] : [];
		});
		const textPosition = run.textPosition === null ? null : Number(run.textPosition);
		const position = subjectRow?.cardPosition ?? (Number.isInteger(textPosition) ? textPosition : null);
		return {
			runId: run.runId,
			model: run.model,
			areaId: run.areaId,
			phrasing: phrasingOf(run.tags),
			tier: run.tier,
			createdAt: run.createdAt,
			subject: subjectRow
				? {
						position,
						positionFrom: subjectRow.cardPosition !== null ? "card" : position !== null ? "text" : null,
						sentiment: run.sentiment && SENTIMENTS.has(run.sentiment) ? (run.sentiment as Sentiment) : null,
					}
				: null,
			competitors,
		};
	});
}

/** The subject's local metrics in scope, each on its own (see `computeLocalMetrics`). */
export async function localMetrics(subjectId: string, scope: LocalMetricsScope): Promise<LocalMetrics> {
	return computeLocalMetrics(await loadMetricRuns(subjectId, scope), scope.since, scope.until);
}
