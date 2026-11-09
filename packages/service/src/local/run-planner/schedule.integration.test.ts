import { brands, organization, prompts } from "@workspace/lib/db/schema";
import type { ModelConfig } from "@workspace/lib/providers";
import { createOwnerDb } from "@workspace/lib/test/integration/owner-db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveServiceArea } from "../service-areas";
import { withSubject } from "../tenancy";
import { NEAR_ME_TAG } from "./plan";
import {
	DEFAULT_RUN_SCHEDULE,
	getRunSchedule,
	previewRunPlan,
	RunScheduleError,
	type RunScheduleSettings,
	saveRunSchedule,
} from "./schedule";

const ORG = "run-schedule-test-org";
const A = "run-schedule-test-a";
const B = "run-schedule-test-b";

const owner = createOwnerDb();
const targets: ModelConfig[] = [{ model: "google-ai-mode", provider: "dataforseo", webSearch: true }];
const weekly: RunScheduleSettings = { ...DEFAULT_RUN_SCHEDULE, enabled: true, monthlyBudgetUsd: 10 };

beforeAll(async () => {
	await cleanUp();
	await owner.insert(organization).values({ id: ORG, name: "Run Schedule Test", slug: ORG, createdAt: new Date() });
	await owner.insert(brands).values([
		{ id: A, name: "Subject A", website: "https://a.example", organizationId: ORG },
		{ id: B, name: "Subject B", website: "https://b.example", organizationId: ORG },
	]);
	await owner.insert(prompts).values([
		{ brandId: A, value: "emergency plumber near me", tags: [NEAR_ME_TAG] },
		{ brandId: A, value: "water heater repair near me", tags: [NEAR_ME_TAG] },
	]);
	await withSubject(A, () =>
		saveServiceArea(A, {
			name: "Raleigh",
			centerLat: 35.7796,
			centerLng: -78.6382,
			radiusMeters: 16_000,
			timezone: "America/New_York",
		}),
	);
});

afterAll(async () => {
	await cleanUp();
	await owner.$client.end();
});

async function cleanUp() {
	await owner.delete(prompts).where(inArray(prompts.brandId, [A, B]));
	await owner.delete(brands).where(inArray(brands.id, [A, B]));
	await owner.delete(organization).where(eq(organization.id, ORG));
}

const asA = <T>(fn: () => Promise<T>) => withSubject(A, fn);

describe("run schedules", () => {
	it("plans the subject's near-me prompts over its grid", async () => {
		const { plan, refusal } = await asA(() => previewRunPlan(A, weekly, targets));
		const grid = plan.series.find((s) => s.pointKind === "grid");
		expect(grid?.promptIds).toHaveLength(2);
		expect(grid?.pointIds.length).toBeGreaterThan(0);
		expect(plan.costPerMonthUsd).toBeGreaterThan(0);
		expect(refusal).toBeNull();
	});

	it("refuses to enable a schedule over budget and saves nothing", async () => {
		await expect(asA(() => saveRunSchedule(A, { ...weekly, monthlyBudgetUsd: 0.01 }, targets))).rejects.toThrow(
			RunScheduleError,
		);
		expect(await asA(() => getRunSchedule(A))).toEqual(DEFAULT_RUN_SCHEDULE);
	});

	it("saves a disabled schedule whatever it would cost", async () => {
		const saved = await asA(() => saveRunSchedule(A, { ...weekly, enabled: false, monthlyBudgetUsd: 0.01 }, targets));
		expect(saved).toEqual({ ...weekly, enabled: false, monthlyBudgetUsd: 0.01 });
	});

	it("enables a schedule within budget", async () => {
		await asA(() => saveRunSchedule(A, weekly, targets));
		expect(await asA(() => getRunSchedule(A))).toEqual(weekly);
	});

	it("keeps one subject's schedule from another", async () => {
		expect(await withSubject(B, () => getRunSchedule(A))).toEqual(DEFAULT_RUN_SCHEDULE);
	});
});
