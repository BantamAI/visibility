import * as Sentry from "@sentry/node";
import { getDeploymentFeatures } from "@workspace/deployment";
import { db } from "@workspace/lib/db/db";
import { prompts } from "@workspace/lib/db/schema";
import type { OnboardingSuggestion } from "@workspace/lib/onboarding";
import { PROCESS_PROMPT_QUEUE } from "@workspace/lib/queues/prompt-jobs";
import { GENERATE_REPORT_QUEUE } from "@workspace/lib/queues/report-jobs";
import { REFRESH_ROLLUPS_QUEUE, ROLLUP_CATCH_UP_QUEUE } from "@workspace/lib/rollups/constants";
import { DERIVE_ANSWER_BUSINESSES_QUEUE } from "@workspace/service/local/answer-businesses";
import { DISCOVER_COMPETITORS_QUEUE } from "@workspace/service/local/competitor-discovery";
import {
	GRID_SCAN_RUN_QUEUE,
	type GridScanRunData,
	START_GRID_SCANS_QUEUE,
	VENDOR_CONCURRENCY,
} from "@workspace/service/local/grid-scans";
import { DERIVE_LOCAL_MENTIONS_QUEUE } from "@workspace/service/local/local-mentions";
import { RESOLVE_NAMED_BUSINESSES_QUEUE } from "@workspace/service/local/named-businesses";
import { REFRESH_PLACE_IDS_QUEUE } from "@workspace/service/local/places";
import { BRAND_MODE_RUNS } from "@workspace/service/local/run-planner/constants";
import { withAgency, withSubject } from "@workspace/service/local/tenancy";
import { CHECK_VENDOR_SPEND_QUEUE } from "@workspace/service/local/vendor-spend";
import { eq } from "drizzle-orm";
import type { Job, PgBoss } from "pg-boss";
import { type AnalyzeBrandData, analyzeBrandJob } from "./jobs/analyze-brand";
import { deriveAnswerBusinessesJob } from "./jobs/answer-businesses";
import { discoverCompetitorsJob } from "./jobs/competitor-discovery";
import { DERIVE_RUNS_QUEUE, type DeriveRunsData, deriveRunsJob } from "./jobs/derive-runs";
import { type GenerateReportData, generateReportJob } from "./jobs/generate-report";
import { gridScanRunJob, startGridScansJob } from "./jobs/grid-scans";
import { deriveLocalMentionsJob } from "./jobs/local-mentions";
import { resolveNamedBusinessesJob } from "./jobs/named-businesses";
import { refreshPlaceIdsJob } from "./jobs/place-ids";
import { type ProcessPromptData, processPromptJob } from "./jobs/process-prompt";
import { type RefreshRollupsData, refreshRollupsJob } from "./jobs/refresh-rollups";
import {
	REPROCESS_QUEUE,
	REQUEST_REPROCESSES_QUEUE,
	type ReprocessData,
	reprocessJob,
	requestReprocessesJob,
} from "./jobs/reprocess";
import { type RollupCatchUpData, rollupCatchUpJob } from "./jobs/rollup-catch-up";
import { type ScheduleMaintenanceData, scheduleMaintenanceJob } from "./jobs/schedule-maintenance";
import { type SuggestPromptsData, type SuggestPromptsResult, suggestPromptsJob } from "./jobs/suggest-prompts";
import { type SyncAuth0MembershipsData, syncAuth0MembershipsJob } from "./jobs/sync-auth0-memberships";
import { checkVendorSpendJob } from "./jobs/vendor-spend";
import { mentionAnalyzer } from "./mention-judge";

/** Passes the handler's return value through: pg-boss stores it as the job output. */
function withSentry<T, R>(queueName: string, handler: (jobs: Job<T>[]) => Promise<R>): (jobs: Job<T>[]) => Promise<R> {
	return async (jobs) => {
		try {
			return await handler(jobs);
		} catch (error) {
			Sentry.withScope((scope) => {
				scope.setTag("queue", queueName);
				Sentry.captureException(error);
			});
			throw error;
		}
	};
}

/** Runs each job as the brand it handles, so row-level security holds it to that brand's rows. */
function asSubject<T, R>(
	subjectOf: (data: T) => Promise<string | null>,
	handler: (jobs: Job<T>[]) => Promise<R>,
): (jobs: Job<T>[]) => Promise<R> {
	return async (jobs) => {
		let result: R | undefined;
		for (const job of jobs) {
			const subjectId = await subjectOf(job.data);
			if (!subjectId) {
				console.error(`Job ${job.id} names no brand that exists; skipping`);
				continue;
			}
			result = await withSubject(subjectId, () => handler([job]));
		}
		return result as R;
	};
}

/** Runs a job that spans brands with agency access, logged once under the queue's name. */
function asAgency<T, R>(queueName: string, handler: (jobs: Job<T>[]) => Promise<R>): (jobs: Job<T>[]) => Promise<R> {
	return (jobs) =>
		withAgency({ actor: queueName, reason: `pg-boss job ${jobs.map((job) => job.id).join(", ")}` }, () =>
			handler(jobs),
		);
}

const brandOf = async (data: { brandId: string }) => data.brandId;

/** Jobs queued before the brand rode along with the prompt find it the long way. */
async function brandOfPrompt(data: ProcessPromptData): Promise<string | null> {
	if (data.brandId) return data.brandId;
	return withAgency({ actor: PROCESS_PROMPT_QUEUE, reason: `find the brand of prompt ${data.promptId}` }, async () => {
		const [prompt] = await db
			.select({ brandId: prompts.brandId })
			.from(prompts)
			.where(eq(prompts.id, data.promptId))
			.limit(1);
		return prompt?.brandId ?? null;
	});
}

/** Completing the job without running it ends the prompt's chain, since each cycle queues the next. */
async function dropBrandModeJobs(jobs: Job<ProcessPromptData>[]): Promise<void> {
	console.log(`Dropped ${jobs.length} brand-mode prompt job(s): brand-mode runs are off`);
}

export async function registerHandlers(boss: PgBoss): Promise<void> {
	await boss.work<ProcessPromptData>(
		PROCESS_PROMPT_QUEUE,
		{ localConcurrency: 10 },
		withSentry(PROCESS_PROMPT_QUEUE, BRAND_MODE_RUNS ? asSubject(brandOfPrompt, processPromptJob) : dropBrandModeJobs),
	);
	console.log(`Registered handler: ${PROCESS_PROMPT_QUEUE}`);

	if (getDeploymentFeatures().reportGeneration) {
		await boss.work<GenerateReportData>(
			GENERATE_REPORT_QUEUE,
			{ localConcurrency: 2 },
			withSentry(GENERATE_REPORT_QUEUE, asAgency(GENERATE_REPORT_QUEUE, generateReportJob)),
		);
		console.log("Registered handler: generate-report");
	}

	// batchSize: 1 keeps the returned suggestion mapped 1:1 to a single job's
	// output, which the web app reads back via getJobById.
	await boss.work<AnalyzeBrandData, OnboardingSuggestion>(
		"analyze-brand",
		{ batchSize: 1, localConcurrency: 2 },
		withSentry("analyze-brand", asSubject(brandOf, analyzeBrandJob)),
	);
	console.log("Registered handler: analyze-brand");

	await boss.work<SuggestPromptsData, SuggestPromptsResult>(
		"suggest-prompts",
		{ batchSize: 1, localConcurrency: 2 },
		withSentry("suggest-prompts", asSubject(brandOf, suggestPromptsJob)),
	);
	console.log("Registered handler: suggest-prompts");

	await boss.work<ScheduleMaintenanceData>(
		"schedule-maintenance",
		{ localConcurrency: 1 },
		withSentry("schedule-maintenance", asAgency("schedule-maintenance", scheduleMaintenanceJob)),
	);
	console.log("Registered handler: schedule-maintenance");

	// One chunk per job, so each retries on its own.
	await boss.work<DeriveRunsData>(
		DERIVE_RUNS_QUEUE,
		{ batchSize: 1, localConcurrency: mentionAnalyzer().concurrency },
		withSentry(DERIVE_RUNS_QUEUE, asSubject(brandOf, deriveRunsJob)),
	);
	console.log(`Registered handler: ${DERIVE_RUNS_QUEUE}`);

	await boss.work<ReprocessData>(
		REPROCESS_QUEUE,
		{ localConcurrency: 1 },
		withSentry(REPROCESS_QUEUE, asSubject(brandOf, reprocessJob)),
	);
	console.log(`Registered handler: ${REPROCESS_QUEUE}`);
	await boss.work(
		REQUEST_REPROCESSES_QUEUE,
		withSentry(REQUEST_REPROCESSES_QUEUE, asAgency(REQUEST_REPROCESSES_QUEUE, requestReprocessesJob)),
	);
	console.log(`Registered handler: ${REQUEST_REPROCESSES_QUEUE}`);

	if (process.env.DEPLOYMENT_MODE === "whitelabel") {
		await boss.work<SyncAuth0MembershipsData>(
			"sync-auth0-memberships",
			{ localConcurrency: 1 },
			withSentry("sync-auth0-memberships", asAgency("sync-auth0-memberships", syncAuth0MembershipsJob)),
		);
		console.log("Registered handler: sync-auth0-memberships");
	}

	await boss.work(
		START_GRID_SCANS_QUEUE,
		{ localConcurrency: 1 },
		withSentry(START_GRID_SCANS_QUEUE, asAgency(START_GRID_SCANS_QUEUE, startGridScansJob)),
	);
	console.log(`Registered handler: ${START_GRID_SCANS_QUEUE}`);

	// Jobs are grouped by vendor, so each vendor's limit holds across every worker.
	await boss.work<GridScanRunData>(
		GRID_SCAN_RUN_QUEUE,
		{ localConcurrency: 10, groupConcurrency: VENDOR_CONCURRENCY },
		withSentry(GRID_SCAN_RUN_QUEUE, asSubject(brandOf, gridScanRunJob)),
	);
	console.log(`Registered handler: ${GRID_SCAN_RUN_QUEUE}`);

	await boss.work(
		CHECK_VENDOR_SPEND_QUEUE,
		{ localConcurrency: 1 },
		withSentry(CHECK_VENDOR_SPEND_QUEUE, asAgency(CHECK_VENDOR_SPEND_QUEUE, checkVendorSpendJob)),
	);
	console.log(`Registered handler: ${CHECK_VENDOR_SPEND_QUEUE}`);

	await boss.work(
		DERIVE_ANSWER_BUSINESSES_QUEUE,
		{ localConcurrency: 1 },
		withSentry(DERIVE_ANSWER_BUSINESSES_QUEUE, asAgency(DERIVE_ANSWER_BUSINESSES_QUEUE, deriveAnswerBusinessesJob)),
	);
	console.log(`Registered handler: ${DERIVE_ANSWER_BUSINESSES_QUEUE}`);

	await boss.work(
		DERIVE_LOCAL_MENTIONS_QUEUE,
		{ localConcurrency: 1 },
		withSentry(DERIVE_LOCAL_MENTIONS_QUEUE, asAgency(DERIVE_LOCAL_MENTIONS_QUEUE, deriveLocalMentionsJob)),
	);
	console.log(`Registered handler: ${DERIVE_LOCAL_MENTIONS_QUEUE}`);

	await boss.work(
		RESOLVE_NAMED_BUSINESSES_QUEUE,
		{ localConcurrency: 1 },
		withSentry(RESOLVE_NAMED_BUSINESSES_QUEUE, asAgency(RESOLVE_NAMED_BUSINESSES_QUEUE, resolveNamedBusinessesJob)),
	);
	console.log(`Registered handler: ${RESOLVE_NAMED_BUSINESSES_QUEUE}`);

	await boss.work(
		DISCOVER_COMPETITORS_QUEUE,
		{ localConcurrency: 1 },
		withSentry(DISCOVER_COMPETITORS_QUEUE, asAgency(DISCOVER_COMPETITORS_QUEUE, discoverCompetitorsJob)),
	);
	console.log(`Registered handler: ${DISCOVER_COMPETITORS_QUEUE}`);

	await boss.work(
		REFRESH_PLACE_IDS_QUEUE,
		{ localConcurrency: 1 },
		withSentry(REFRESH_PLACE_IDS_QUEUE, asAgency(REFRESH_PLACE_IDS_QUEUE, refreshPlaceIdsJob)),
	);
	console.log(`Registered handler: ${REFRESH_PLACE_IDS_QUEUE}`);

	await boss.work<RefreshRollupsData>(
		REFRESH_ROLLUPS_QUEUE,
		{ localConcurrency: 1 },
		withSentry(REFRESH_ROLLUPS_QUEUE, asAgency(REFRESH_ROLLUPS_QUEUE, refreshRollupsJob)),
	);
	console.log(`Registered handler: ${REFRESH_ROLLUPS_QUEUE}`);

	await boss.work<RollupCatchUpData>(
		ROLLUP_CATCH_UP_QUEUE,
		{ localConcurrency: 1 },
		withSentry(ROLLUP_CATCH_UP_QUEUE, asAgency(ROLLUP_CATCH_UP_QUEUE, rollupCatchUpJob)),
	);
	console.log(`Registered handler: ${ROLLUP_CATCH_UP_QUEUE}`);
}
