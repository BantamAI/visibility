import { dedupeKey } from "@workspace/lib/bulk-prompts";
import { db } from "@workspace/lib/db/db";
import { brands, prompts } from "@workspace/lib/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { listServices } from "../competitor-discovery/manage";
import { samplePoints, subjectServiceAreas, subjectServices } from "../schema";
import { type AreaCities, citiesByArea, factCityOf } from "./cities";
import { type GeneratedPrompt, generateLocalPrompts } from "./templates";

export class LocalPromptError extends Error {
	override name = "LocalPromptError";
}

export const MAX_JOBS_PER_SERVICE = 5;
const MAX_JOB_LENGTH = 80;

export async function setServiceJobs(subjectId: string, serviceId: string, input: readonly string[]): Promise<string[]> {
	const jobs: string[] = [];
	for (const raw of input) {
		const job = raw.trim().replace(/\s+/g, " ");
		if (!job || jobs.some((known) => known.toLowerCase() === job.toLowerCase())) continue;
		if (job.length > MAX_JOB_LENGTH) throw new LocalPromptError(`Keep a job under ${MAX_JOB_LENGTH} characters`);
		jobs.push(job);
	}
	if (jobs.length > MAX_JOBS_PER_SERVICE) {
		throw new LocalPromptError(`A service can have at most ${MAX_JOBS_PER_SERVICE} jobs`);
	}
	const updated = await db
		.update(subjectServices)
		.set({ jobs })
		.where(and(eq(subjectServices.subjectId, subjectId), eq(subjectServices.id, serviceId)))
		.returning({ id: subjectServices.id });
	if (updated.length === 0) throw new LocalPromptError("That service isn't this subject's");
	return jobs;
}

export async function listAreaCities(subjectId: string): Promise<AreaCities[]> {
	const [areas, centroids] = await Promise.all([
		db
			.select()
			.from(subjectServiceAreas)
			.where(eq(subjectServiceAreas.subjectId, subjectId))
			.orderBy(desc(subjectServiceAreas.isPrimary), asc(subjectServiceAreas.createdAt)),
		db
			.select()
			.from(samplePoints)
			.where(
				and(
					eq(samplePoints.subjectId, subjectId),
					eq(samplePoints.kind, "centroid"),
					eq(samplePoints.active, true),
				),
			),
	]);
	return citiesByArea(areas, centroids);
}

export interface DraftPrompt extends GeneratedPrompt {
	/** Already one of the subject's prompts, so adding skips it. */
	exists: boolean;
}

export interface LocalPromptDraft {
	prompts: DraftPrompt[];
	/** All the subject's prompts, enabled or not, before these are added. */
	existingCount: number;
}

/** The local prompts the subject's services, jobs and the picked cities make, marking those it already has. */
export async function draftLocalPrompts(subjectId: string, cityTags: readonly string[]): Promise<LocalPromptDraft> {
	const [[brand], services, areas, existing] = await Promise.all([
		db.select({ name: brands.name }).from(brands).where(eq(brands.id, subjectId)),
		listServices(subjectId),
		listAreaCities(subjectId),
		db.select({ value: prompts.value }).from(prompts).where(eq(prompts.brandId, subjectId)),
	]);
	if (!brand) throw new LocalPromptError("No such subject");

	const known = new Map(areas.flatMap(({ cities }) => cities.map((city) => [city.tag, city] as const)));
	const unknown = cityTags.filter((tag) => !known.has(tag));
	if (unknown.length > 0) throw new LocalPromptError("Pick cities from the subject's service areas");

	const generated = generateLocalPrompts({
		business: brand.name,
		services: services.map((service) => ({ name: service.name, jobs: service.jobs })),
		cities: [...new Set(cityTags)].flatMap((tag) => known.get(tag) ?? []),
		factCity: factCityOf(areas),
	});
	const have = new Set(existing.map((row) => dedupeKey(row.value)));
	return {
		prompts: generated.map((prompt) => ({ ...prompt, exists: have.has(dedupeKey(prompt.value)) })),
		existingCount: existing.length,
	};
}
