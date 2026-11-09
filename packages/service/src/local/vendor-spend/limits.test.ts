import { describe, expect, it } from "vitest";
import { dailyPlanByVendor, overspentVendors } from "./limits";

const scan = (provider: string, estimatedCostUsd: number | null) => ({
	config: { model: "google-ai-mode", provider, webSearch: true },
	estimatedCostUsd,
});

describe("dailyPlanByVendor", () => {
	it("plans for every scan on a vendor starting the same day", () => {
		const plan = dailyPlanByVendor([scan("dataforseo", 0.036), scan("dataforseo", 0.012), scan("anthropic-api", 0.2)]);
		expect(plan.get("dataforseo")).toBeCloseTo(0.048);
		expect(plan.get("anthropic-api")).toBeCloseTo(0.2);
	});
});

describe("overspentVendors", () => {
	const plan = new Map([["dataforseo", 0.1]]);

	it("allows spend up to exactly twice the plan, despite float rounding", () => {
		expect(overspentVendors(new Map([["dataforseo", 0.1 + 0.1]]), plan)).toEqual([]);
	});

	it("stops a vendor past twice its plan", () => {
		expect(overspentVendors(new Map([["dataforseo", 0.200001]]), plan)).toEqual([
			{ provider: "dataforseo", spendUsd: 0.200001, planUsd: 0.1 },
		]);
	});

	it("stops a vendor that spent with no plan at all", () => {
		expect(overspentVendors(new Map([["cloro", 0.01]]), plan)).toEqual([
			{ provider: "cloro", spendUsd: 0.01, planUsd: 0 },
		]);
	});

	it("ignores vendors that cost nothing", () => {
		expect(overspentVendors(new Map([["stub", 0]]), plan)).toEqual([]);
	});
});
