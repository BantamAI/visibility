import * as Sentry from "@sentry/node";
import { parseScrapeTargets } from "@workspace/config/scrape-targets";
import { db } from "@workspace/lib/db/db";
import { brands } from "@workspace/lib/db/schema";
import { getProvider } from "@workspace/lib/providers";
import {
	claimScanRun,
	finishScanIfDone,
	finishStaleScans,
	GRID_SCAN_RUN_QUEUE,
	type GridScanRunData,
	MAX_RUN_ATTEMPTS,
	markScanRunAnswered,
	type QueuedScanRun,
	recordScanRunFailure,
	startDueScans,
} from "@workspace/service/local/grid-scans";
import { LocationNotHonouredError } from "@workspace/service/local/locations";
import { subjectRunSchedules } from "@workspace/service/local/schema";
import { withSubject } from "@workspace/service/local/tenancy";
import { VendorStoppedError } from "@workspace/service/local/vendor-spend";
import { eq } from "drizzle-orm";
import type { Job, PgBoss } from "pg-boss";
import { getBoss } from "../boss";
import { deriveNewRunBusinesses } from "./answer-businesses";
import { runModelIteration } from "./process-prompt";

function reportOverBudget(subjectId: string, refusal: string): void {
	console.warn(`[grid-scans] Not starting scans for ${subjectId}: ${refusal}`);
	Sentry.withScope((scope) => {
		scope.setLevel("warning");
		scope.setTag("scheduler", "grid-scan-budget");
		scope.setFingerprint(["grid-scan-budget", subjectId]);
		Sentry.captureMessage(`Grid scans for ${subjectId} held back: ${refusal}`, "warning");
	});
}

async function queueRuns(boss: PgBoss, subjectId: string, runs: readonly QueuedScanRun[]): Promise<void> {
	await boss.insert(
		GRID_SCAN_RUN_QUEUE,
		runs.map((run) => ({
			data: { brandId: subjectId, scanRunId: run.id } satisfies GridScanRunData,
			singletonKey: run.id,
			group: { id: run.provider, tier: run.provider },
		})),
	);
}

/**
 * Starts the scans every enabled schedule has due, one subject at a time, and settles
 * scans whose runs were lost. Runs with agency access to find the schedules.
 */
export async function startGridScansJob(): Promise<void> {
	const finished = await finishStaleScans();
	if (finished > 0) console.warn(`[grid-scans] Completed ${finished} scan(s) whose runs never settled`);

	const scrapeTargets = parseScrapeTargets(process.env.SCRAPE_TARGETS);
	const enabled = await db
		.select({ subjectId: subjectRunSchedules.subjectId })
		.from(subjectRunSchedules)
		.where(eq(subjectRunSchedules.enabled, true));

	for (const { subjectId } of enabled) {
		try {
			const started = await withSubject(subjectId, () => startDueScans(subjectId, scrapeTargets));
			if (started.refusal) reportOverBudget(subjectId, started.refusal);
			if (started.runs.length === 0) continue;
			await queueRuns(getBoss(), subjectId, started.runs);
			console.log(
				`[grid-scans] Started ${started.scanIds.length} scan(s) with ${started.runs.length} run(s) for ${subjectId}`,
			);
		} catch (error) {
			// One subject's failure mustn't hold up the others; its scans are due again next tick.
			console.error(`[grid-scans] Couldn't start scans for ${subjectId}:`, error);
			Sentry.captureException(error);
		}
	}
}

function failureMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function runScanPoint({ brandId, scanRunId }: GridScanRunData): Promise<void> {
	const claim = await claimScanRun(scanRunId);
	if (!claim) return;
	if (claim.attempts > MAX_RUN_ATTEMPTS) {
		await recordScanRunFailure(claim.id, `Gave up after ${MAX_RUN_ATTEMPTS} attempts`, true);
		await finishScanIfDone(claim.scanId);
		return;
	}
	const brand = await db.query.brands.findFirst({ where: eq(brands.id, brandId) });
	if (!brand) return;

	try {
		const runId = await runModelIteration({
			promptId: claim.promptId,
			promptValue: claim.promptValue,
			brand,
			config: claim.config,
			providerImpl: getProvider(claim.config.provider),
			runIndex: claim.repeat,
			location: claim.request,
			onSaved: (tx, promptRunId) => markScanRunAnswered(tx, claim.id, promptRunId),
		});
		// Never throws: a run whose cards fail here is picked up by the sweep, not retried and paid for again.
		await deriveNewRunBusinesses(brandId, runId);
	} catch (error) {
		// Neither a refused location nor a stopped vendor changes on a retry, and nothing was spent on either.
		const final =
			error instanceof LocationNotHonouredError ||
			error instanceof VendorStoppedError ||
			claim.attempts >= MAX_RUN_ATTEMPTS;
		await recordScanRunFailure(claim.id, failureMessage(error), final);
		if (!final) throw error;
	}
	await finishScanIfDone(claim.scanId);
}

/** One run of a scan: a point and a repeat. A failure is retried by the queue until it's final. */
export async function gridScanRunJob(jobs: Job<GridScanRunData>[]): Promise<void> {
	for (const job of jobs) await runScanPoint(job.data);
}
