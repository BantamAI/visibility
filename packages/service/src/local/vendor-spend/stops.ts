import { db } from "@workspace/lib/db/db";
import { brands, usageEvents } from "@workspace/lib/db/schema";
import type { ModelConfig } from "@workspace/lib/providers";
import { and, eq, gt, gte, inArray, isNotNull, isNull, max, or, sql } from "drizzle-orm";
import { type ScanSpec, scansFor } from "../grid-scans/plan-scans";
import { getRunSchedule, previewRunPlan } from "../run-planner";
import { subjectRunSchedules, vendorSpendStops } from "../schema";
import { dailyPlanByVendor, OVERSPEND_FACTOR, overspentVendors, type VendorSpend } from "./limits";

export class VendorStoppedError extends Error {
	override name = "VendorStoppedError";
	constructor(readonly provider: string) {
		super(`${provider} is stopped: its spend today ran past ${OVERSPEND_FACTOR}× its plan`);
	}
}

export function startOfUtcDay(now: Date): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function stoppedVendors(): Promise<Set<string>> {
	const rows = await db
		.select({ provider: vendorSpendStops.provider })
		.from(vendorSpendStops)
		.where(isNull(vendorSpendStops.resumedAt));
	return new Set(rows.map((row) => row.provider));
}

/** Throws before anything is spent on a stopped vendor. */
export async function assertVendorRunning(provider: string): Promise<void> {
	const [stop] = await db
		.select({ id: vendorSpendStops.id })
		.from(vendorSpendStops)
		.where(and(eq(vendorSpendStops.provider, provider), isNull(vendorSpendStops.resumedAt)))
		.limit(1);
	if (stop) throw new VendorStoppedError(provider);
}

/** Only runs are planned; spend on other calls (Places lookups) is outside these limits. */
const RUN_EVENTS = ["prompt_run", "prompt_run_failed"];

/** Each vendor's run spend today, counted from its last resume when that was today. Needs agency access. */
async function spendToday(now: Date): Promise<Map<string, number>> {
	const dayStart = startOfUtcDay(now);
	const resumes = db
		.select({ provider: vendorSpendStops.provider, resumedAt: max(vendorSpendStops.resumedAt).as("resumed_at") })
		.from(vendorSpendStops)
		.where(gte(vendorSpendStops.resumedAt, dayStart))
		.groupBy(vendorSpendStops.provider)
		.as("resumes");
	const rows = await db
		.select({
			provider: usageEvents.provider,
			spendUsd: sql<number>`coalesce(sum(${usageEvents.estimatedCostUsd}), 0)`.mapWith(Number),
		})
		.from(usageEvents)
		.leftJoin(resumes, eq(resumes.provider, usageEvents.provider))
		.where(
			and(
				gte(usageEvents.createdAt, dayStart),
				inArray(usageEvents.eventType, RUN_EVENTS),
				isNotNull(usageEvents.provider),
				or(isNull(resumes.resumedAt), gt(usageEvents.createdAt, resumes.resumedAt)),
			),
		)
		.groupBy(usageEvents.provider);
	return new Map(rows.flatMap((row) => (row.provider ? [[row.provider, row.spendUsd]] : [])));
}

/** Scans that can start on an enabled schedule within its budget. Needs agency access. */
async function enabledScans(scrapeTargets: readonly ModelConfig[]): Promise<ScanSpec[]> {
	const enabled = await db
		.select({ subjectId: subjectRunSchedules.subjectId })
		.from(subjectRunSchedules)
		.innerJoin(brands, eq(brands.id, subjectRunSchedules.subjectId))
		.where(and(eq(subjectRunSchedules.enabled, true), eq(brands.enabled, true)));
	const specs: ScanSpec[] = [];
	for (const { subjectId } of enabled) {
		const { plan, refusal, points } = await previewRunPlan(subjectId, await getRunSchedule(subjectId), scrapeTargets);
		if (!refusal) specs.push(...scansFor(plan, points));
	}
	return specs;
}

/** Stops each vendor whose spend today ran past twice its plan, returning those newly stopped. Needs agency access. */
export async function checkVendorSpend(
	scrapeTargets: readonly ModelConfig[],
	now = new Date(),
): Promise<VendorSpend[]> {
	const [spend, specs, stopped] = await Promise.all([spendToday(now), enabledScans(scrapeTargets), stoppedVendors()]);
	const over = overspentVendors(spend, dailyPlanByVendor(specs)).filter((v) => !stopped.has(v.provider));
	if (over.length === 0) return [];
	const inserted = await db
		.insert(vendorSpendStops)
		.values(over.map((v) => ({ ...v, stoppedAt: now })))
		.onConflictDoNothing()
		.returning({ provider: vendorSpendStops.provider });
	const newlyStopped = new Set(inserted.map((row) => row.provider));
	return over.filter((v) => newlyStopped.has(v.provider));
}

/** Returns false when the vendor wasn't stopped. Needs agency access. */
export async function resumeVendor(provider: string, resumedBy: string, now = new Date()): Promise<boolean> {
	const resumed = await db
		.update(vendorSpendStops)
		.set({ resumedAt: now, resumedBy })
		.where(and(eq(vendorSpendStops.provider, provider), isNull(vendorSpendStops.resumedAt)))
		.returning({ id: vendorSpendStops.id });
	return resumed.length > 0;
}

export interface VendorSpendRow extends VendorSpend {
	limitUsd: number;
	stop: { stoppedAt: Date; spendUsd: number; planUsd: number } | null;
}

/** Every vendor with a plan, spend or stop today. Needs agency access. */
export async function vendorSpendToday(
	scrapeTargets: readonly ModelConfig[],
	now = new Date(),
): Promise<VendorSpendRow[]> {
	const [spend, specs, stops] = await Promise.all([
		spendToday(now),
		enabledScans(scrapeTargets),
		db.select().from(vendorSpendStops).where(isNull(vendorSpendStops.resumedAt)),
	]);
	const plan = dailyPlanByVendor(specs);
	const stopByProvider = new Map(stops.map((stop) => [stop.provider, stop]));
	const providers = [...new Set([...plan.keys(), ...spend.keys(), ...stopByProvider.keys()])].sort();
	return providers.map((provider) => {
		const planUsd = plan.get(provider) ?? 0;
		const stop = stopByProvider.get(provider);
		return {
			provider,
			spendUsd: spend.get(provider) ?? 0,
			planUsd,
			limitUsd: planUsd * OVERSPEND_FACTOR,
			stop: stop ? { stoppedAt: stop.stoppedAt, spendUsd: stop.spendUsd, planUsd: stop.planUsd } : null,
		};
	});
}
