import { db } from "@workspace/lib/db/db";
import { brands, prompts } from "@workspace/lib/db/schema";
import { getProvider, type ModelConfig, selectTargetsForBrand } from "@workspace/lib/providers";
import { and, eq } from "drizzle-orm";
import { type RunSchedule, samplePoints, subjectRunSchedules } from "../schema";
import { budgetRefusal, planRuns, type RunCadence, type RunPlan } from "./plan";

export type RunScheduleSettings = RunCadence & {
	enabled: boolean;
	monthlyBudgetUsd: number | null;
};

export const DEFAULT_RUN_SCHEDULE: RunScheduleSettings = {
	enabled: false,
	monthlyBudgetUsd: null,
	scanIntervalDays: 7,
	centroidIntervalDays: 1,
	repeats: 1,
};

export const MAX_INTERVAL_DAYS = 31;
export const MAX_REPEATS = 5;

export class RunScheduleError extends Error {
	override name = "RunScheduleError";
}

function ensure(condition: boolean, message: string): asserts condition {
	if (!condition) throw new RunScheduleError(message);
}

function isWhole(value: number, min: number, max: number): boolean {
	return Number.isInteger(value) && value >= min && value <= max;
}

export function validateRunScheduleSettings(settings: RunScheduleSettings): RunScheduleSettings {
	ensure(
		isWhole(settings.scanIntervalDays, 1, MAX_INTERVAL_DAYS),
		`Days between scans must be from 1 to ${MAX_INTERVAL_DAYS}`,
	);
	ensure(
		isWhole(settings.centroidIntervalDays, 1, MAX_INTERVAL_DAYS),
		`Days between city runs must be from 1 to ${MAX_INTERVAL_DAYS}`,
	);
	ensure(isWhole(settings.repeats, 1, MAX_REPEATS), `Repeats must be from 1 to ${MAX_REPEATS}`);
	const budget = settings.monthlyBudgetUsd;
	ensure(budget === null || (Number.isFinite(budget) && budget >= 0), "The budget can't be negative");
	return { ...settings, monthlyBudgetUsd: budget === null ? null : Math.round(budget * 100) / 100 };
}

function settingsFrom(row: RunSchedule | undefined): RunScheduleSettings {
	if (!row) return DEFAULT_RUN_SCHEDULE;
	return {
		enabled: row.enabled,
		monthlyBudgetUsd: row.monthlyBudgetUsd,
		scanIntervalDays: row.scanIntervalDays,
		centroidIntervalDays: row.centroidIntervalDays,
		repeats: row.repeats,
	};
}

export async function getRunSchedule(subjectId: string): Promise<RunScheduleSettings> {
	const [row] = await db.select().from(subjectRunSchedules).where(eq(subjectRunSchedules.subjectId, subjectId));
	return settingsFrom(row);
}

/** The plan these settings would run for the subject, with why it can't be enabled, if it can't. */
export async function previewRunPlan(
	subjectId: string,
	settings: RunScheduleSettings,
	scrapeTargets: readonly ModelConfig[],
): Promise<{ plan: RunPlan; refusal: string | null }> {
	const [brand] = await db
		.select({ enabledModels: brands.enabledModels })
		.from(brands)
		.where(eq(brands.id, subjectId));
	if (!brand) throw new RunScheduleError("No such subject");
	const [subjectPrompts, points] = await Promise.all([
		db
			.select({ id: prompts.id, tags: prompts.tags })
			.from(prompts)
			.where(and(eq(prompts.brandId, subjectId), eq(prompts.enabled, true))),
		db
			.select()
			.from(samplePoints)
			.where(and(eq(samplePoints.subjectId, subjectId), eq(samplePoints.active, true)))
			.orderBy(samplePoints.areaId, samplePoints.kind, samplePoints.label),
	]);
	const plan = planRuns({
		targets: selectTargetsForBrand([...scrapeTargets], brand.enabledModels),
		prompts: subjectPrompts,
		points,
		cadence: settings,
		getProvider,
	});
	return { plan, refusal: budgetRefusal(plan, settings.monthlyBudgetUsd) };
}

/** Refuses to leave the schedule enabled when its plan doesn't fit the budget. */
export async function saveRunSchedule(
	subjectId: string,
	input: RunScheduleSettings,
	scrapeTargets: readonly ModelConfig[],
): Promise<RunScheduleSettings> {
	const settings = validateRunScheduleSettings(input);
	if (settings.enabled) {
		const { refusal } = await previewRunPlan(subjectId, settings, scrapeTargets);
		if (refusal) throw new RunScheduleError(refusal);
	}
	const [row] = await db
		.insert(subjectRunSchedules)
		.values({ subjectId, ...settings })
		.onConflictDoUpdate({ target: subjectRunSchedules.subjectId, set: settings })
		.returning();
	return settingsFrom(row);
}
