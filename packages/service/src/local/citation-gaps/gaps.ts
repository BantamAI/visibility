import { extractDomain } from "@workspace/lib/citations/domain-categories";
import { classifyUrl } from "@workspace/lib/citations/domain-lists";
import { db } from "@workspace/lib/db/db";
import { brands, citations, competitors, promptRuns } from "@workspace/lib/db/schema";
import { and, eq, gte, inArray, lt, type SQL } from "drizzle-orm";
import type { PgSelect } from "drizzle-orm/pg-core";
import { competitorDomain } from "../competitor-discovery/tally";
import { areaCompetitors, localMentions, runLocations, samplePoints } from "../schema";
import { type CitationGap, type GapRun, rankCitationGaps } from "./rank";

export interface CitationGapScope {
	areaId: string;
	since: Date;
	until: Date;
	/** Only runs of these prompts; every prompt when left out. */
	promptIds?: readonly string[];
	model?: string;
}

export interface AreaCitationGaps {
	/** Tracked competitors in the area; with none, there's nothing to compare against. */
	trackedCompetitors: number;
	/** Answers in the area that name the subject or a tracked competitor. */
	runs: number;
	gaps: CitationGap[];
}

const lower = (name: string) => name.trim().toLowerCase();

/** Narrows a query on `local_mentions` to the counted mentions of runs in scope. */
const inScope = <T extends PgSelect>(query: T, where: SQL | undefined) =>
	query
		.innerJoin(runLocations, eq(runLocations.runId, localMentions.runId))
		.innerJoin(samplePoints, eq(samplePoints.id, runLocations.pointId))
		.innerJoin(promptRuns, eq(promptRuns.id, localMentions.runId))
		.where(where);

async function ownedDomains(subjectId: string, trackedWebsites: (string | null)[]) {
	const [brand] = await db
		.select({ website: brands.website, additionalDomains: brands.additionalDomains })
		.from(brands)
		.where(eq(brands.id, subjectId));
	const elmoCompetitors = await db
		.select({ domains: competitors.domains })
		.from(competitors)
		.where(eq(competitors.brandId, subjectId));
	const brandDomains = new Set(
		[brand?.website ?? "", ...(brand?.additionalDomains ?? [])].map(extractDomain).filter(Boolean),
	);
	const competitorDomains = new Set(
		[
			...elmoCompetitors.flatMap((competitor) => competitor.domains.map(extractDomain)),
			...trackedWebsites.map(competitorDomain),
		].filter((domain): domain is string => Boolean(domain)),
	);
	return { brandDomains, competitorDomains };
}

/** The sources an area's answers cite for its tracked competitors but never for the subject (see `rankCitationGaps`). */
export async function areaCitationGaps(subjectId: string, scope: CitationGapScope): Promise<AreaCitationGaps> {
	const tracked = await db
		.select({ name: areaCompetitors.name, website: areaCompetitors.website })
		.from(areaCompetitors)
		.where(
			and(
				eq(areaCompetitors.subjectId, subjectId),
				eq(areaCompetitors.areaId, scope.areaId),
				eq(areaCompetitors.tracked, true),
			),
		);
	if (tracked.length === 0 || scope.promptIds?.length === 0)
		return { trackedCompetitors: tracked.length, runs: 0, gaps: [] };
	const trackedNames = new Map(tracked.map(({ name }) => [lower(name), name]));

	const filters: SQL[] = [
		eq(localMentions.subjectId, subjectId),
		eq(localMentions.counted, true),
		eq(samplePoints.areaId, scope.areaId),
		gte(promptRuns.createdAt, scope.since),
		lt(promptRuns.createdAt, scope.until),
	];
	if (scope.promptIds) filters.push(inArray(promptRuns.promptId, [...scope.promptIds]));
	if (scope.model) filters.push(eq(promptRuns.model, scope.model));
	const where = and(...filters);
	const mentioned = await inScope(
		db
			.select({ runId: localMentions.runId, competitorName: localMentions.competitorName, model: promptRuns.model })
			.from(localMentions)
			.$dynamic(),
		where,
	);

	const runs = new Map<string, GapRun & { competitors: string[] }>();
	for (const { runId, competitorName, model } of mentioned) {
		const competitor = competitorName === null ? undefined : trackedNames.get(lower(competitorName));
		if (competitorName !== null && !competitor) continue;
		const run = runs.get(runId) ?? { runId, model, subjectCounted: false, competitors: [] };
		runs.set(runId, run);
		if (competitor) run.competitors.push(competitor);
		else run.subjectCounted = true;
	}
	if (runs.size === 0) return { trackedCompetitors: tracked.length, runs: 0, gaps: [] };

	const [cited, owned] = await Promise.all([
		db
			.select({ runId: citations.promptRunId, domain: citations.domain, url: citations.url, title: citations.title })
			.from(citations)
			.where(
				and(
					eq(citations.brandId, subjectId),
					inArray(
						citations.promptRunId,
						inScope(db.select({ runId: localMentions.runId }).from(localMentions).$dynamic(), where),
					),
				),
			),
		ownedDomains(
			subjectId,
			tracked.map(({ website }) => website),
		),
	]);
	const gaps = rankCitationGaps(
		[...runs.values()],
		cited.map((citation) => {
			const domain = extractDomain(citation.domain) || citation.domain;
			return {
				...citation,
				domain,
				category: classifyUrl(domain, citation.url, citation.title, owned.brandDomains, owned.competitorDomains),
			};
		}),
	);
	return { trackedCompetitors: tracked.length, runs: runs.size, gaps };
}
