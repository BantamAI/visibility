import { createServerFn } from "@tanstack/react-start";
import { areaCitationGaps } from "@workspace/service/local/citation-gaps";
import { withSubject } from "@workspace/service/local/tenancy";
import { z } from "zod";
import { requireBrandSession } from "@/lib/auth/helpers";
import { lookbackSchema } from "@/lib/lookback";
import { localPromptIds, localReportWindow, subjectAreas } from "@/server/local-scope";

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
		const window = await localReportWindow(data.brandId, data.lookback);
		const promptIds = await localPromptIds(data.brandId, data.tags);

		return withSubject(data.brandId, async () => {
			const areas = await subjectAreas(data.brandId);
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
