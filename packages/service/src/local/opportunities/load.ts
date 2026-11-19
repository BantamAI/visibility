import { extractDomain } from "@workspace/lib/citations/domain-categories";
import { classifyUrl } from "@workspace/lib/citations/domain-lists";
import { db } from "@workspace/lib/db/db";
import { brands, citations, promptRuns, prompts } from "@workspace/lib/db/schema";
import { getEffectiveBrandedStatus } from "@workspace/lib/tag-utils";
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { areaCitationGaps, ownedDomains } from "../citation-gaps";
import { loadMetricRuns } from "../local-metrics/load";
import { areaCompetitors, runLocations, samplePoints, subjectServiceAreas, subjectServices } from "../schema";
import type { DigestArea, DigestCitation, DigestInput } from "./digest";

export interface PlaybookWindow {
	since: Date;
	until: Date;
	days: number;
}

/** The subject's service areas, primary first. Runs in the caller's subject scope. */
export const serviceAreas = (subjectId: string) =>
	db
		.select({ id: subjectServiceAreas.id, name: subjectServiceAreas.name, primary: subjectServiceAreas.isPrimary })
		.from(subjectServiceAreas)
		.where(eq(subjectServiceAreas.subjectId, subjectId))
		.orderBy(desc(subjectServiceAreas.isPrimary), asc(subjectServiceAreas.createdAt));

async function locatedCitations(subjectId: string, window: PlaybookWindow) {
	return db
		.select({
			runId: citations.promptRunId,
			promptId: citations.promptId,
			areaId: samplePoints.areaId,
			domain: citations.domain,
			url: citations.url,
			title: citations.title,
		})
		.from(citations)
		.innerJoin(runLocations, eq(runLocations.runId, citations.promptRunId))
		.innerJoin(samplePoints, eq(samplePoints.id, runLocations.pointId))
		.innerJoin(promptRuns, eq(promptRuns.id, citations.promptRunId))
		.where(
			and(
				eq(citations.brandId, subjectId),
				gte(promptRuns.createdAt, window.since),
				lt(promptRuns.createdAt, window.until),
			),
		);
}

/** Everything the playbook digest reads for the subject's located answers in the window. Runs in the caller's subject scope. */
export async function loadDigestInput(
	subjectId: string,
	window: PlaybookWindow,
): Promise<DigestInput & { organizationId: string }> {
	const [[brand], services, promptRows, areas, tracked, runs, cited] = await Promise.all([
		db
			.select({ name: brands.name, website: brands.website, organizationId: brands.organizationId })
			.from(brands)
			.where(eq(brands.id, subjectId)),
		db
			.select({ name: subjectServices.name, jobs: subjectServices.jobs })
			.from(subjectServices)
			.where(eq(subjectServices.subjectId, subjectId))
			.orderBy(asc(subjectServices.createdAt)),
		db
			.select({ id: prompts.id, value: prompts.value, tags: prompts.tags, systemTags: prompts.systemTags })
			.from(prompts)
			.where(and(eq(prompts.brandId, subjectId), eq(prompts.enabled, true))),
		serviceAreas(subjectId),
		db
			.select({ areaId: areaCompetitors.areaId, name: areaCompetitors.name, website: areaCompetitors.website })
			.from(areaCompetitors)
			.where(and(eq(areaCompetitors.subjectId, subjectId), eq(areaCompetitors.tracked, true))),
		loadMetricRuns(subjectId, window),
		locatedCitations(subjectId, window),
	]);
	if (!brand) throw new Error(`No subject ${subjectId}`);

	const owned = await ownedDomains(
		subjectId,
		tracked.map(({ website }) => website),
	);
	const matched = new Set(runs.map((run) => run.runId));
	const citationsByArea = new Map<string, DigestCitation[]>();
	for (const citation of cited) {
		if (!matched.has(citation.runId) || !citation.promptId) continue;
		const domain = extractDomain(citation.domain) || citation.domain;
		const list = citationsByArea.get(citation.areaId) ?? [];
		list.push({
			runId: citation.runId,
			promptId: citation.promptId,
			domain,
			url: citation.url,
			title: citation.title,
			category: classifyUrl(domain, citation.url, citation.title, owned.brandDomains, owned.competitorDomains),
		});
		citationsByArea.set(citation.areaId, list);
	}

	const digestAreas = await Promise.all(
		areas.map(
			async (area): Promise<DigestArea> => ({
				name: area.name,
				primary: area.primary,
				competitors: tracked.filter(({ areaId }) => areaId === area.id).map(({ name }) => name),
				runs: runs.filter((run) => run.areaId === area.id),
				citations: citationsByArea.get(area.id) ?? [],
				gaps: (await areaCitationGaps(subjectId, { areaId: area.id, since: window.since, until: window.until })).gaps,
			}),
		),
	);

	return {
		organizationId: brand.organizationId,
		subject: { name: brand.name, website: brand.website },
		services,
		prompts: promptRows.map((prompt) => ({
			id: prompt.id,
			value: prompt.value,
			tags: prompt.tags ?? [],
			branded: getEffectiveBrandedStatus(prompt.systemTags ?? [], prompt.tags ?? []).isBranded,
		})),
		areas: digestAreas,
		windowDays: window.days,
	};
}
