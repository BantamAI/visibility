import { db } from "@workspace/lib/db/db";
import { prompts, SYSTEM_TAGS } from "@workspace/lib/db/schema";
import { subjectServiceAreas } from "@workspace/service/local/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import { citationDateWindow } from "@/lib/chart-utils";
import { customRangeEnd, type lookbackSchema } from "@/lib/lookback";
import { resolveBrandLookbackDays } from "@/server/brand-window";
import { promptIdsMatchingTags } from "@/server/citations";
import { parseTagFilter } from "@/server/prompt-resolution";

const DAY_MS = 86_400_000;

/** The same UTC day window as the rest of the brand's pages. */
export async function localReportWindow(brandId: string, lookback: z.infer<typeof lookbackSchema>) {
	const days = await resolveBrandLookbackDays(brandId, lookback);
	const endDate = customRangeEnd(lookback);
	const window = citationDateWindow(endDate ? new Date(`${endDate}T00:00:00Z`) : new Date(), days);
	return {
		since: new Date(`${window.fromDateStr}T00:00:00Z`),
		until: new Date(Date.parse(`${window.toDateStr}T00:00:00Z`) + DAY_MS),
	};
}

const enabledPrompts = (brandId: string) =>
	db
		.select({ id: prompts.id, tags: prompts.tags, systemTags: prompts.systemTags })
		.from(prompts)
		.where(and(eq(prompts.brandId, brandId), eq(prompts.enabled, true)));

/** The prompts a tag filter picks; undefined, meaning every prompt, when there's no filter. */
export async function localPromptIds(brandId: string, tags: string | undefined): Promise<string[] | undefined> {
	const tagFilter = parseTagFilter(tags);
	if (tagFilter.length === 0) return undefined;
	return promptIdsMatchingTags(await enabledPrompts(brandId), tagFilter);
}

/** The tags the filter bar offers: branded and unbranded, then the prompts' own. */
export async function localAvailableTags(brandId: string): Promise<string[]> {
	const own = new Set((await enabledPrompts(brandId)).flatMap((prompt) => prompt.tags ?? []));
	const system = new Set<string>([SYSTEM_TAGS.BRANDED, SYSTEM_TAGS.UNBRANDED]);
	return [...system, ...[...own].filter((tag) => !system.has(tag.toLowerCase())).sort()];
}

/** The subject's service areas, primary first. Runs in the caller's subject scope. */
export const subjectAreas = (brandId: string) =>
	db
		.select({ id: subjectServiceAreas.id, name: subjectServiceAreas.name })
		.from(subjectServiceAreas)
		.where(eq(subjectServiceAreas.subjectId, brandId))
		.orderBy(desc(subjectServiceAreas.isPrimary), asc(subjectServiceAreas.createdAt));
