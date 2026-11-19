import { createServerFn } from "@tanstack/react-start";
import { listHeatMapScans, localMetrics, scanHeatMap } from "@workspace/service/local/local-metrics";
import { withSubject } from "@workspace/service/local/tenancy";
import { z } from "zod";
import { requireBrandSession } from "@/lib/auth/helpers";
import { lookbackSchema } from "@/lib/lookback";
import { localAvailableTags, localPromptIds, localReportWindow, subjectAreas } from "@/server/local-scope";

const tierSchema = z.enum(["T1", "T2", "T3", "T4", "T5"]);

const scopeSchema = z.object({
	brandId: z.string(),
	areaId: z.string().uuid().optional(),
	lookback: lookbackSchema.default("1m"),
	tags: z.string().optional(),
	model: z.string().optional(),
	/** Every tier when left out. */
	tiers: z.array(tierSchema).optional(),
});

async function resolveScope(data: z.infer<typeof scopeSchema>) {
	await requireBrandSession(data.brandId);
	const [window, promptIds] = await Promise.all([
		localReportWindow(data.brandId, data.lookback),
		localPromptIds(data.brandId, data.tags),
	]);
	return {
		...window,
		areaId: data.areaId,
		model: data.model,
		tiers: data.tiers,
		promptIds,
	};
}

export const getLocalMetricsFn = createServerFn({ method: "GET" })
	.validator(scopeSchema)
	.handler(async ({ data }) => {
		const scope = await resolveScope(data);
		const availableTags = await localAvailableTags(data.brandId);
		return withSubject(data.brandId, async () => {
			const areas = await subjectAreas(data.brandId);
			const window = { since: scope.since, until: scope.until };
			if (areas.length === 0) return { areas, availableTags, metrics: null, window };
			const areaId = areas.some(({ id }) => id === scope.areaId) ? scope.areaId : undefined;
			const metrics = await localMetrics(data.brandId, { ...scope, areaId });
			return { areas, availableTags, metrics, window };
		});
	});

export const getLocalHeatMapScansFn = createServerFn({ method: "GET" })
	.validator(scopeSchema)
	.handler(async ({ data }) => {
		const scope = await resolveScope(data);
		return withSubject(data.brandId, () => listHeatMapScans(data.brandId, scope));
	});

export const getLocalHeatMapFn = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string(), scanId: z.string().uuid() }))
	.handler(async ({ data }) => {
		await requireBrandSession(data.brandId);
		return withSubject(data.brandId, () => scanHeatMap(data.scanId));
	});
