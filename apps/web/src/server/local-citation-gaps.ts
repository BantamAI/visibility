import { createServerFn } from "@tanstack/react-start";
import { db } from "@workspace/lib/db/db";
import { prompts } from "@workspace/lib/db/schema";
import { areaCitationGaps } from "@workspace/service/local/citation-gaps";
import { subjectServiceAreas } from "@workspace/service/local/schema";
import { withSubject } from "@workspace/service/local/tenancy";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireBrandSession } from "@/lib/auth/helpers";
import { citationDateWindow } from "@/lib/chart-utils";
import { customRangeEnd, lookbackSchema } from "@/lib/lookback";
import { resolveBrandLookbackDays } from "@/server/brand-window";
import { promptIdsMatchingTags } from "@/server/citations";
import { parseTagFilter } from "@/server/prompt-resolution";

const DAY_MS = 86_400_000;

/** The same UTC day window as the rest of the Citations page. */
async function citationWindow(brandId: string, lookback: z.infer<typeof lookbackSchema>) {
	const days = await resolveBrandLookbackDays(brandId, lookback);
	const endDate = customRangeEnd(lookback);
	const window = citationDateWindow(endDate ? new Date(`${endDate}T00:00:00Z`) : new Date(), days);
	return {
		since: new Date(`${window.fromDateStr}T00:00:00Z`),
		until: new Date(Date.parse(`${window.toDateStr}T00:00:00Z`) + DAY_MS),
	};
}

export const getLocalCitationGapsFn = createServerFn({ method: "GET" })
	.validator(
		z.object({
			brandId: z.string(),
			areaId: z.string().uuid().optional(),
			lookback: lookbackSchema.default("1w"),
			tags: z.string().optional(),
			model: z.string().optional(),
		}),
	)
	.handler(async ({ data }) => {
		await requireBrandSession(data.brandId);
		const window = await citationWindow(data.brandId, data.lookback);
		const tagFilter = parseTagFilter(data.tags);
		const promptIds =
			tagFilter.length > 0
				? promptIdsMatchingTags(
						await db
							.select({ id: prompts.id, tags: prompts.tags, systemTags: prompts.systemTags })
							.from(prompts)
							.where(and(eq(prompts.brandId, data.brandId), eq(prompts.enabled, true))),
						tagFilter,
					)
				: undefined;

		return withSubject(data.brandId, async () => {
			const areas = await db
				.select({ id: subjectServiceAreas.id, name: subjectServiceAreas.name })
				.from(subjectServiceAreas)
				.where(eq(subjectServiceAreas.subjectId, data.brandId))
				.orderBy(desc(subjectServiceAreas.isPrimary), asc(subjectServiceAreas.createdAt));
			const area = areas.find(({ id }) => id === data.areaId) ?? areas[0];
			if (!area) return { areas, areaId: null, result: null };
			const result = await areaCitationGaps(data.brandId, {
				areaId: area.id,
				...window,
				promptIds,
				model: data.model,
			});
			return { areas, areaId: area.id, result };
		});
	});
