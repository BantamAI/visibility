import { db } from "@workspace/lib/db/db";
import { brands, organization, prompts, usageEvents } from "@workspace/lib/db/schema";
import type { ModelConfig } from "@workspace/lib/providers";
import { createOwnerDb } from "@workspace/lib/test/integration/owner-db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDueScans } from "../grid-scans/scans";
import { DEFAULT_RUN_SCHEDULE, NEAR_ME_TAG, saveRunSchedule } from "../run-planner";
import { gridScans, vendorSpendStops } from "../schema";
import { saveServiceArea } from "../service-areas";
import { withSubject } from "../tenancy";
import { assertVendorRunning, checkVendorSpend, resumeVendor, VendorStoppedError, vendorSpendToday } from "./stops";

const ORG = "vendor-spend-test-org";
const A = "vendor-spend-test-a";
const UNPLANNED = "vendor-spend-test-unplanned";
const owner = createOwnerDb();
const targets: ModelConfig[] = [{ model: "google-ai-mode", provider: "dataforseo", webSearch: true }];

// A day of its own, so spend other tests record today never counts here.
const DAY = new Date("2031-03-04T00:00:00Z");
const at = (hours: number) => new Date(DAY.getTime() + hours * 60 * 60 * 1000);

beforeAll(async () => {
	await cleanUp();
	await owner.insert(organization).values({ id: ORG, name: "Vendor Spend Test", slug: ORG, createdAt: new Date() });
	await owner
		.insert(brands)
		.values({ id: A, name: A, website: "https://a.example", organizationId: ORG, enabled: true });
	await owner.insert(prompts).values({ brandId: A, value: "emergency plumber near me", tags: [NEAR_ME_TAG] });
	await withSubject(A, async () => {
		await saveServiceArea(A, {
			name: "Raleigh",
			centerLat: 35.7796,
			centerLng: -78.6382,
			radiusMeters: 16_000,
			timezone: "America/New_York",
		});
		await saveRunSchedule(A, { ...DEFAULT_RUN_SCHEDULE, enabled: true, monthlyBudgetUsd: 50 }, targets);
	});
});

afterAll(async () => {
	await cleanUp();
	await owner.$client.end();
});

async function cleanUp() {
	await owner.delete(vendorSpendStops).where(inArray(vendorSpendStops.provider, ["dataforseo", UNPLANNED]));
	await owner.delete(usageEvents).where(eq(usageEvents.organizationId, ORG));
	await owner.delete(gridScans).where(eq(gridScans.subjectId, A));
	await owner.delete(prompts).where(eq(prompts.brandId, A));
	await owner.delete(brands).where(eq(brands.id, A));
	await owner.delete(organization).where(eq(organization.id, ORG));
}

async function spend(provider: string, usd: number, createdAt: Date, eventType = "prompt_run") {
	await owner.insert(usageEvents).values({
		organizationId: ORG,
		brandId: A,
		eventType,
		provider,
		estimatedCostUsd: usd.toFixed(6),
		createdAt,
	});
}

async function dataforseoPlan(now: Date): Promise<number> {
	const row = (await vendorSpendToday(targets, now)).find((r) => r.provider === "dataforseo");
	if (!row) throw new Error("dataforseo has no plan");
	return row.planUsd;
}

describe("vendor spend stops", () => {
	it("lets a vendor spend up to twice its plan for the day", async () => {
		const plan = await dataforseoPlan(at(1));
		expect(plan).toBeGreaterThan(0);
		await spend("dataforseo", 50, at(-1));
		await spend("dataforseo", plan * 2, at(1));
		await spend("google-places", 5, at(1), "places_call");

		expect(await checkVendorSpend(targets, at(1))).toEqual([]);
		await expect(withSubject(A, () => assertVendorRunning("dataforseo"))).resolves.toBeUndefined();
	});

	it("stops a vendor once its spend runs past twice its plan, and every vendor with spend but no plan", async () => {
		const plan = await dataforseoPlan(at(2));
		await spend("dataforseo", 0.01, at(2));
		await spend(UNPLANNED, 0.01, at(2));

		const stopped = await checkVendorSpend(targets, at(2));
		expect(stopped.map((s) => s.provider).sort()).toEqual(["dataforseo", UNPLANNED].sort());
		expect(stopped.find((s) => s.provider === "dataforseo")).toMatchObject({ planUsd: plan });
		expect(await checkVendorSpend(targets, at(2))).toEqual([]);
	});

	it("runs nothing on a stopped vendor", async () => {
		await expect(withSubject(A, () => assertVendorRunning("dataforseo"))).rejects.toBeInstanceOf(VendorStoppedError);
		const started = await withSubject(A, () => startDueScans(A, targets, at(3)));
		expect(started.scanIds).toEqual([]);
	});

	it("keeps a vendor stopped until staff resume it, counting only spend after the resume", async () => {
		expect(await resumeVendor("dataforseo", "staff@example.com", at(4))).toBe(true);
		expect(await resumeVendor("dataforseo", "staff@example.com", at(4))).toBe(false);
		await spend("dataforseo", 0.001, at(5));

		expect(await checkVendorSpend(targets, at(5))).toEqual([]);
		await expect(withSubject(A, () => assertVendorRunning("dataforseo"))).resolves.toBeUndefined();
		const started = await withSubject(A, () => startDueScans(A, targets, at(5)));
		expect(started.scanIds).toHaveLength(1);
	});

	it("shows each vendor's spend, plan and stop for the day", async () => {
		const rows = await vendorSpendToday(targets, at(5));
		const dataforseo = rows.find((r) => r.provider === "dataforseo");
		const unplanned = rows.find((r) => r.provider === UNPLANNED);
		expect(dataforseo).toMatchObject({ spendUsd: 0.001, stop: null });
		expect(dataforseo?.limitUsd).toBeCloseTo((dataforseo?.planUsd ?? 0) * 2);
		expect(unplanned).toMatchObject({ planUsd: 0, spendUsd: 0.01, stop: { spendUsd: 0.01, planUsd: 0 } });
	});
});

it("reads stops from subject-scoped work without being able to lift them", async () => {
	const rows = await withSubject(A, () =>
		db
			.select({ provider: vendorSpendStops.provider })
			.from(vendorSpendStops)
			.where(eq(vendorSpendStops.provider, UNPLANNED)),
	);
	expect(rows).toHaveLength(1);
	await expect(withSubject(A, () => resumeVendor(UNPLANNED, "subject"))).rejects.toThrow();
});
