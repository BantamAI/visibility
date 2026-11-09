import { readFileSync } from "node:fs";
import { db } from "@workspace/lib/db/db";
import { brands, organization, promptRuns, prompts } from "@workspace/lib/db/schema";
import type { ModelConfig } from "@workspace/lib/providers";
import { createOwnerDb } from "@workspace/lib/test/integration/owner-db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deriveAnswerBusinesses } from "../answer-businesses";
import { DEFAULT_RUN_SCHEDULE, NEAR_ME_TAG, saveRunSchedule } from "../run-planner";
import { gridScanRuns, gridScans, runLocations, subjectRunSchedules } from "../schema";
import { saveServiceArea } from "../service-areas";
import { withSubject } from "../tenancy";
import { getScanResults, listScans } from "./results";
import {
	claimScanRun,
	finishScanIfDone,
	finishStaleScans,
	markScanRunAnswered,
	recordScanRunFailure,
	STALE_SCAN_HOURS,
	startDueScans,
} from "./scans";

const ORG = "grid-scan-test-org";
const A = "grid-scan-test-a";
const B = "grid-scan-test-b";
const subjects = [A, B];

const owner = createOwnerDb();
const targets: ModelConfig[] = [{ model: "google-ai-mode", provider: "dataforseo", webSearch: true }];
const COST_PER_RUN = 0.004;
const AI_MODE_ANSWER = JSON.parse(
	readFileSync(new URL("../answer-businesses/__fixtures__/dataforseo-ai-mode.json", import.meta.url), "utf8"),
);

beforeAll(async () => {
	await cleanUp();
	await owner.insert(organization).values({ id: ORG, name: "Grid Scan Test", slug: ORG, createdAt: new Date() });
	await owner
		.insert(brands)
		.values(
			subjects.map((id) => ({ id, name: id, website: `https://${id}.example`, organizationId: ORG, enabled: true })),
		);
	for (const subject of subjects) {
		await owner.insert(prompts).values({ brandId: subject, value: "emergency plumber near me", tags: [NEAR_ME_TAG] });
		await withSubject(subject, async () => {
			await saveServiceArea(subject, {
				name: "Raleigh",
				centerLat: 35.7796,
				centerLng: -78.6382,
				radiusMeters: 16_000,
				timezone: "America/New_York",
			});
			await saveRunSchedule(subject, { ...DEFAULT_RUN_SCHEDULE, enabled: true, monthlyBudgetUsd: 50 }, targets);
		});
	}
});

afterAll(async () => {
	await cleanUp();
	await owner.$client.end();
});

async function cleanUp() {
	await owner.delete(gridScans).where(inArray(gridScans.subjectId, subjects));
	await owner.delete(promptRuns).where(inArray(promptRuns.brandId, subjects));
	await owner.delete(prompts).where(inArray(prompts.brandId, subjects));
	await owner.delete(brands).where(inArray(brands.id, subjects));
	await owner.delete(organization).where(eq(organization.id, ORG));
}

const asA = <T>(fn: () => Promise<T>) => withSubject(A, fn);

/** What the worker does when a vendor answers: save the run and its location, settle the scan run, and read its cards. */
async function answer(scanRunId: string) {
	const claim = await claimScanRun(scanRunId);
	if (!claim) throw new Error(`run ${scanRunId} isn't pending`);
	const runId = await db.transaction(async (tx) => {
		const [run] = await tx
			.insert(promptRuns)
			.values({
				promptId: claim.promptId,
				brandId: A,
				model: claim.config.model,
				provider: claim.config.provider,
				version: "test",
				webSearchEnabled: true,
				rawOutput: AI_MODE_ANSWER,
			})
			.returning({ id: promptRuns.id });
		await tx.insert(runLocations).values({
			runId: run.id,
			subjectId: A,
			pointId: claim.request.location.pointId,
			requestedLocation: claim.request.location,
			locationMethod: "geo_coordinate",
			fidelityTier: "T1",
			costUsd: COST_PER_RUN.toFixed(6),
			costSource: "estimate",
		});
		await markScanRunAnswered(tx, claim.id, run.id);
		return run.id;
	});
	await deriveAnswerBusinesses([runId]);
	return claim;
}

describe("grid scans", () => {
	let scanId: string;
	let runIds: string[];

	it("starts a scan with one run per point of the route's kind", async () => {
		const started = await asA(() => startDueScans(A, targets));
		expect(started.refusal).toBeNull();
		expect(started.scanIds).toHaveLength(1);
		const [scan] = await asA(() => db.select().from(gridScans).where(eq(gridScans.id, started.scanIds[0])));
		expect(scan).toMatchObject({ pointKind: "grid", fidelityTier: "T1", provider: "dataforseo", status: "running" });
		expect(started.runs).toHaveLength(scan.pointsPlanned);
		expect(scan.estimatedCostUsd).toBeCloseTo(scan.pointsPlanned * COST_PER_RUN);
		scanId = scan.id;
		runIds = started.runs.map((run) => run.id);
	});

	it("doesn't start the same scan again before its interval", async () => {
		expect((await asA(() => startDueScans(A, targets))).scanIds).toEqual([]);
	});

	it("counts attempts and leaves a failed run pending until its failure is final", async () => {
		const claim = await asA(() => claimScanRun(runIds[0]));
		expect(claim?.attempts).toBe(1);
		await asA(() => recordScanRunFailure(runIds[0], "vendor timed out", false));
		expect(await asA(() => finishScanIfDone(scanId))).toBe(false);
		expect((await asA(() => claimScanRun(runIds[0])))?.attempts).toBe(2);
		await asA(() => recordScanRunFailure(runIds[0], "vendor timed out again", true));
		expect(await asA(() => claimScanRun(runIds[0]))).toBeNull();
	});

	it("completes with coverage and cost once every run settles", async () => {
		for (const id of runIds.slice(1)) await asA(() => answer(id));
		expect(await asA(() => answer(runIds[1]).catch(() => "settled"))).toBe("settled");

		expect(await asA(() => finishScanIfDone(scanId))).toBe(true);
		expect(await asA(() => finishScanIfDone(scanId))).toBe(false);

		const [summary] = await asA(() => listScans(A));
		expect(summary).toMatchObject({ id: scanId, status: "complete", areaName: "Raleigh" });
		expect(summary.pointsAnswered).toBe(summary.pointsPlanned - 1);
		expect(summary.coverage).toBeCloseTo((summary.pointsPlanned - 1) / summary.pointsPlanned);
		expect(summary.costUsd).toBeCloseTo((summary.pointsPlanned - 1) * COST_PER_RUN);
	});

	it("returns every point's results for a heat map, with the failed point as a gap", async () => {
		const results = await asA(() => getScanResults(scanId));
		expect(results?.points).toHaveLength(runIds.length);
		const failed = results?.points.filter((p) => p.runs.every((run) => run.status === "failed"));
		expect(failed).toHaveLength(1);
		expect(failed?.[0].runs[0].error).toBe("vendor timed out again");
		const answered = results?.points.find((p) => p.runs[0].status === "answered");
		expect(answered?.runs[0].runId).toEqual(expect.any(String));
		expect(answered?.label).toEqual(expect.any(String));
		expect(answered?.runs[0].businesses.map((card) => card.name).slice(0, 2)).toEqual([
			"Bee Quick Plumbing & Sewer",
			"Wiz Plumbing Inc.",
		]);
	});

	it("completes a scan whose runs were lost, failing what never settled", async () => {
		const started = await withSubject(B, () => startDueScans(B, targets));
		const later = new Date(Date.now() + (STALE_SCAN_HOURS + 1) * 60 * 60 * 1000);
		expect(await withSubject(B, () => finishStaleScans(later))).toBe(1);
		const [summary] = await withSubject(B, () => listScans(B));
		expect(summary).toMatchObject({ id: started.scanIds[0], status: "complete", pointsAnswered: 0, coverage: 0 });
	});

	it("holds back every scan when the plan no longer fits the budget", async () => {
		await owner.update(subjectRunSchedules).set({ monthlyBudgetUsd: 0.01 }).where(eq(subjectRunSchedules.subjectId, B));
		const started = await withSubject(B, () => startDueScans(B, targets, new Date(Date.now() + 8 * 86_400_000)));
		expect(started.refusal).toMatch(/over the \$0\.01 budget/);
		expect(started.scanIds).toEqual([]);
	});

	it("keeps one subject's scans from another", async () => {
		expect(await withSubject(B, () => listScans(A))).toEqual([]);
		expect(await withSubject(B, () => getScanResults(scanId))).toBeNull();
		expect(await withSubject(B, () => claimScanRun(runIds[1]))).toBeNull();
		const [run] = await owner.select().from(gridScanRuns).where(eq(gridScanRuns.id, runIds[1]));
		expect(run.status).toBe("answered");
	});
});
