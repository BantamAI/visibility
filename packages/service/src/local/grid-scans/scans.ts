import { db } from "@workspace/lib/db/db";
import { brands, prompts } from "@workspace/lib/db/schema";
import type { ModelConfig } from "@workspace/lib/providers";
import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type { LocationRequest } from "../locations";
import { toRunLocation } from "../locations/run-location";
import { getRunSchedule, MAX_INTERVAL_DAYS, previewRunPlan } from "../run-planner";
import { gridScanRuns, gridScans, runLocations } from "../schema";
import { stoppedVendors } from "../vendor-spend/stops";
import { dueScans, type ScanSpec, scanKey, scansFor } from "./plan-scans";

export interface QueuedScanRun {
	id: string;
	provider: string;
}

export interface StartedScans {
	/** Why the subject's plan no longer fits its budget; nothing was started. */
	refusal: string | null;
	scanIds: string[];
	runs: QueuedScanRun[];
}

const NOTHING: StartedScans = { refusal: null, scanIds: [], runs: [] };

async function lastScanStarts(subjectId: string, now: Date): Promise<Map<string, Date>> {
	const since = new Date(now.getTime() - (MAX_INTERVAL_DAYS + 1) * 24 * 60 * 60 * 1000);
	const rows = await db
		.select({
			areaId: gridScans.areaId,
			promptId: gridScans.promptId,
			model: gridScans.model,
			provider: gridScans.provider,
			pointKind: gridScans.pointKind,
			lastStartedAt: sql<Date>`MAX(${gridScans.createdAt})`.mapWith((value) => new Date(value)),
		})
		.from(gridScans)
		.where(and(eq(gridScans.subjectId, subjectId), gt(gridScans.createdAt, since)))
		.groupBy(gridScans.areaId, gridScans.promptId, gridScans.model, gridScans.provider, gridScans.pointKind);
	return new Map(rows.map((row) => [scanKey(row), row.lastStartedAt]));
}

async function insertScans(subjectId: string, specs: readonly ScanSpec[]): Promise<StartedScans> {
	return db.transaction(async (tx) => {
		const started: StartedScans = { refusal: null, scanIds: [], runs: [] };
		for (const spec of specs) {
			const [scan] = await tx
				.insert(gridScans)
				.values({
					subjectId,
					areaId: spec.areaId,
					promptId: spec.promptId,
					model: spec.config.model,
					provider: spec.config.provider,
					webSearchEnabled: spec.config.webSearch,
					version: spec.config.version ?? null,
					fidelityTier: spec.tier,
					pointKind: spec.pointKind,
					repeats: spec.repeats,
					uncovered: spec.uncovered,
					estimatedCostUsd: spec.estimatedCostUsd,
					pointsPlanned: spec.points.length,
				})
				.returning({ id: gridScans.id });
			const runs = await tx
				.insert(gridScanRuns)
				.values(
					spec.points.flatMap((point) =>
						Array.from({ length: spec.repeats }, (_, i) => ({
							subjectId,
							scanId: scan.id,
							pointId: point.id,
							location: toRunLocation(point),
							repeat: i + 1,
						})),
					),
				)
				.returning({ id: gridScanRuns.id });
			started.scanIds.push(scan.id);
			started.runs.push(...runs.map((run) => ({ id: run.id, provider: spec.config.provider })));
		}
		return started;
	});
}

/**
 * Starts every scan the subject's enabled schedule has due, after checking the plan
 * still fits the budget: prompts or areas added since the schedule was saved can push
 * it over. A stopped vendor's scans wait until it's resumed. The caller queues the
 * returned runs.
 */
export async function startDueScans(
	subjectId: string,
	scrapeTargets: readonly ModelConfig[],
	now = new Date(),
): Promise<StartedScans> {
	const schedule = await getRunSchedule(subjectId);
	if (!schedule.enabled) return NOTHING;
	const [brand] = await db.select({ enabled: brands.enabled }).from(brands).where(eq(brands.id, subjectId));
	if (!brand?.enabled) return NOTHING;

	const { plan, refusal, points } = await previewRunPlan(subjectId, schedule, scrapeTargets);
	if (refusal) return { ...NOTHING, refusal };
	const stopped = await stoppedVendors();
	const due = dueScans(scansFor(plan, points), await lastScanStarts(subjectId, now), now).filter(
		(spec) => !stopped.has(spec.config.provider),
	);
	if (due.length === 0) return NOTHING;
	return insertScans(subjectId, due);
}

export interface ClaimedScanRun {
	id: string;
	scanId: string;
	promptId: string;
	promptValue: string;
	config: ModelConfig;
	request: LocationRequest;
	repeat: number;
	/** Including this one. */
	attempts: number;
}

/** Counts an attempt on a run that's still pending, or returns null when it's already settled. */
export async function claimScanRun(scanRunId: string): Promise<ClaimedScanRun | null> {
	const [run] = await db
		.update(gridScanRuns)
		.set({ attempts: sql`${gridScanRuns.attempts} + 1` })
		.where(and(eq(gridScanRuns.id, scanRunId), eq(gridScanRuns.status, "pending")))
		.returning();
	if (!run) return null;
	const [scan] = await db
		.select({ scan: gridScans, promptValue: prompts.value })
		.from(gridScans)
		.innerJoin(prompts, eq(prompts.id, gridScans.promptId))
		.where(eq(gridScans.id, run.scanId));
	if (!scan) return null;
	const { scan: s } = scan;
	return {
		id: run.id,
		scanId: run.scanId,
		promptId: s.promptId,
		promptValue: scan.promptValue,
		config: {
			model: s.model,
			provider: s.provider,
			webSearch: s.webSearchEnabled,
			...(s.version ? { version: s.version } : {}),
		},
		request: { location: run.location, tier: s.fidelityTier },
		repeat: run.repeat,
		attempts: run.attempts,
	};
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Called in the transaction that saves the run, so a saved answer is never asked for again. */
export async function markScanRunAnswered(tx: Tx, scanRunId: string, runId: string): Promise<void> {
	await tx
		.update(gridScanRuns)
		.set({ status: "answered", runId, lastError: null })
		.where(and(eq(gridScanRuns.id, scanRunId), eq(gridScanRuns.status, "pending")));
}

/** A final failure makes the point a gap in this scan; otherwise the run stays pending for its retry. */
export async function recordScanRunFailure(scanRunId: string, error: string, final: boolean): Promise<void> {
	await db
		.update(gridScanRuns)
		.set({ lastError: error.slice(0, 2000), ...(final ? { status: "failed" as const } : {}) })
		.where(and(eq(gridScanRuns.id, scanRunId), eq(gridScanRuns.status, "pending")));
}

/**
 * Completes the scan once none of its runs is pending, with its coverage and cost.
 * Safe to call from every run: only the call that sees the last run settle changes it.
 */
export async function finishScanIfDone(scanId: string): Promise<boolean> {
	const finished = await db
		.update(gridScans)
		.set({
			status: "complete",
			completedAt: sql`now()`,
			pointsAnswered: sql`(SELECT count(DISTINCT r.point_id)::int FROM ${gridScanRuns} r WHERE r.scan_id = ${gridScans.id} AND r.status = 'answered')`,
			costUsd: sql`(SELECT sum(l.cost_usd) FROM ${gridScanRuns} r JOIN ${runLocations} l ON l.run_id = r.run_id WHERE r.scan_id = ${gridScans.id})`,
		})
		.where(
			and(
				eq(gridScans.id, scanId),
				eq(gridScans.status, "running"),
				sql`NOT EXISTS (SELECT 1 FROM ${gridScanRuns} r WHERE r.scan_id = ${gridScans.id} AND r.status = 'pending')`,
			),
		)
		.returning({ id: gridScans.id });
	return finished.length > 0;
}

/** Long past the last retry of any run, so a run still pending lost its job. */
export const STALE_SCAN_HOURS = 6;

/** Fails the runs whose jobs were lost and completes their scans, for every subject the scope reaches. */
export async function finishStaleScans(now = new Date()): Promise<number> {
	const cutoff = new Date(now.getTime() - STALE_SCAN_HOURS * 60 * 60 * 1000);
	const stale = await db
		.select({ id: gridScans.id })
		.from(gridScans)
		.where(and(eq(gridScans.status, "running"), lt(gridScans.createdAt, cutoff)));
	if (stale.length === 0) return 0;
	const ids = stale.map((scan) => scan.id);
	await db
		.update(gridScanRuns)
		.set({ status: "failed", lastError: "The run's job was lost before it settled." })
		.where(and(inArray(gridScanRuns.scanId, ids), eq(gridScanRuns.status, "pending")));
	let finished = 0;
	for (const id of ids) if (await finishScanIfDone(id)) finished++;
	return finished;
}
