import { createServerFn } from "@tanstack/react-start";
import { getModelMeta } from "@workspace/config/models";
import { parseScrapeTargets } from "@workspace/config/scrape-targets";
import { describeProvider } from "@workspace/lib/providers";
import { listScans, scansFor } from "@workspace/service/local/grid-scans";
import {
	getRunSchedule,
	MAX_INTERVAL_DAYS,
	MAX_REPEATS,
	type PlannerPoint,
	previewRunPlan,
	type RunPlan,
	type RunScheduleSettings,
	saveRunSchedule,
} from "@workspace/service/local/run-planner";
import { withSubject } from "@workspace/service/local/tenancy";
import { z } from "zod";
import { requireBrandSession } from "@/lib/auth/helpers";

const settingsSchema = z.object({
	enabled: z.boolean(),
	monthlyBudgetUsd: z.number().min(0).nullable(),
	scanIntervalDays: z.number().int().min(1).max(MAX_INTERVAL_DAYS),
	centroidIntervalDays: z.number().int().min(1).max(MAX_INTERVAL_DAYS),
	repeats: z.number().int().min(1).max(MAX_REPEATS),
});

const seriesKey = (s: { config: { model: string; provider: string }; tier: string; pointKind: string }) =>
	`${s.config.model}|${s.config.provider}|${s.tier}|${s.pointKind}`;

/** Each series' scans differ in cost only by how many points their area has. */
function scanCostRanges(plan: RunPlan, points: PlannerPoint[]) {
	const ranges = new Map<string, { min: number; max: number }>();
	for (const scan of scansFor(plan, points)) {
		if (scan.estimatedCostUsd === null) continue;
		const key = seriesKey(scan);
		const range = ranges.get(key);
		ranges.set(key, {
			min: Math.min(range?.min ?? scan.estimatedCostUsd, scan.estimatedCostUsd),
			max: Math.max(range?.max ?? scan.estimatedCostUsd, scan.estimatedCostUsd),
		});
	}
	return ranges;
}

function describePlan(plan: RunPlan, points: PlannerPoint[]) {
	const scanCosts = scanCostRanges(plan, points);
	return {
		series: plan.series.map((s) => ({
			key: seriesKey(s),
			engine: getModelMeta(s.engine).label,
			provider: describeProvider(s.config.provider).name,
			tier: s.tier,
			pointKind: s.pointKind,
			points: s.pointIds.length,
			prompts: s.promptIds.length,
			intervalDays: s.intervalDays,
			runsPerMonth: s.runsPerMonth,
			costPerMonthUsd: s.costPerMonthUsd,
			costPerScanUsd: scanCosts.get(seriesKey(s)) ?? null,
		})),
		uncovered: plan.uncovered.map((u) => ({
			key: `${u.engine}|${u.pointId}`,
			engine: getModelMeta(u.engine).label,
			point: u.pointLabel,
			standIn: u.standIn?.pointLabel ?? null,
			reason: u.reason,
		})),
		paused: plan.paused.map((p) => ({
			key: p.engine,
			engine: getModelMeta(p.engine).label,
			provider: describeProvider(p.config.provider).name,
			tier: p.tier,
		})),
		runsPerMonth: plan.runsPerMonth,
		costPerMonthUsd: plan.costPerMonthUsd,
	};
}

async function preview(brandId: string, settings: RunScheduleSettings) {
	const { plan, refusal, points } = await previewRunPlan(
		brandId,
		settings,
		parseScrapeTargets(process.env.SCRAPE_TARGETS),
	);
	return { plan: describePlan(plan, points), refusal };
}

export const getRunPlan = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string() }))
	.handler(async ({ data }) => {
		await requireBrandSession(data.brandId);
		return withSubject(data.brandId, async () => {
			const schedule = await getRunSchedule(data.brandId);
			return { schedule, ...(await preview(data.brandId, schedule)) };
		});
	});

export const previewRunPlanFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string(), settings: settingsSchema }))
	.handler(async ({ data }) => {
		await requireBrandSession(data.brandId);
		return withSubject(data.brandId, () => preview(data.brandId, data.settings));
	});

export const saveRunScheduleFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string(), settings: settingsSchema }))
	.handler(async ({ data }) => {
		await requireBrandSession(data.brandId);
		await withSubject(data.brandId, () =>
			saveRunSchedule(data.brandId, data.settings, parseScrapeTargets(process.env.SCRAPE_TARGETS)),
		);
	});

export const getRecentScans = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string() }))
	.handler(async ({ data }) => {
		await requireBrandSession(data.brandId);
		const scans = await withSubject(data.brandId, () => listScans(data.brandId, 25));
		return scans.map((scan) => ({
			...scan,
			engine: getModelMeta(scan.model).label,
			provider: describeProvider(scan.provider).name,
			createdAt: scan.createdAt.toISOString(),
			completedAt: scan.completedAt?.toISOString() ?? null,
		}));
	});
