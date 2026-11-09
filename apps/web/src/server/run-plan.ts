import { createServerFn } from "@tanstack/react-start";
import { getModelMeta } from "@workspace/config/models";
import { parseScrapeTargets } from "@workspace/config/scrape-targets";
import { describeProvider } from "@workspace/lib/providers";
import {
	getRunSchedule,
	MAX_INTERVAL_DAYS,
	MAX_REPEATS,
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

function describePlan(plan: RunPlan) {
	return {
		series: plan.series.map((s) => ({
			key: `${s.engine}|${s.config.provider}|${s.tier}|${s.pointKind}`,
			engine: getModelMeta(s.engine).label,
			provider: describeProvider(s.config.provider).name,
			tier: s.tier,
			pointKind: s.pointKind,
			points: s.pointIds.length,
			prompts: s.promptIds.length,
			intervalDays: s.intervalDays,
			runsPerMonth: s.runsPerMonth,
			costPerMonthUsd: s.costPerMonthUsd,
		})),
		uncovered: plan.uncovered.map((u) => ({
			key: `${u.engine}|${u.pointId}`,
			engine: getModelMeta(u.engine).label,
			point: u.pointLabel,
			reason: u.reasons.join("; "),
		})),
		runsPerMonth: plan.runsPerMonth,
		costPerMonthUsd: plan.costPerMonthUsd,
	};
}

async function preview(brandId: string, settings: RunScheduleSettings) {
	const { plan, refusal } = await previewRunPlan(brandId, settings, parseScrapeTargets(process.env.SCRAPE_TARGETS));
	return { plan: describePlan(plan), refusal };
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
