import type { LocationSupport, ModelConfig, Provider } from "@workspace/lib/providers";
import { describe, expect, it } from "vitest";
import { NEAR_ME_TAG } from "./constants";
import { budgetRefusal, type PlanInput, type PlannerPoint, planRuns } from "./plan";

function provider(id: string, support: Record<string, LocationSupport[]> = {}): Provider {
	return {
		id,
		name: id,
		access: "scraped",
		isConfigured: () => true,
		run: async () => ({ rawOutput: {}, webQueries: [] }),
		locationSupport: (config: ModelConfig) => support[config.model] ?? [],
	};
}

const coordinates: LocationSupport[] = [{ tier: "T1", reads: ["latitude", "longitude"] }];
const providers: Record<string, Provider> = {
	dataforseo: provider("dataforseo", { "google-ai-mode": coordinates, "google-ai-overview": coordinates }),
	cloro: provider("cloro", { "google-ai-mode": [{ tier: "T1", reads: ["googleCanonicalName"] }] }),
	"anthropic-api": provider("anthropic-api", { claude: [{ tier: "T4", reads: ["city", "region", "country"] }] }),
	brightdata: provider("brightdata"),
	searchapi: provider("searchapi"),
	unpriced: provider("unpriced"),
};
const getProvider = (id: string) => providers[id] as Provider;

const target = (spec: string): ModelConfig => {
	const [model, provider, version] = spec.split(":");
	return { model, provider, webSearch: true, ...(version ? { version } : {}) };
};

let nextPoint = 0;
function point(kind: PlannerPoint["kind"], fields: Partial<PlannerPoint> = {}): PlannerPoint {
	nextPoint += 1;
	return {
		id: `point-${nextPoint}`,
		kind,
		label: `${kind} ${nextPoint}`,
		lat: 35.78,
		lng: -78.64,
		city: "Raleigh",
		region: "NC",
		country: "US",
		postalCode: "27601",
		timezone: "America/New_York",
		googleCanonicalName: "Raleigh,North Carolina,United States",
		...fields,
	};
}

const grid = Array.from({ length: 9 }, () => point("grid"));
const centroid = point("centroid");
const zip = point("zip");
const nearMe = { id: "plumber-near-me", tags: [NEAR_ME_TAG] };
const cityNamed = { id: "plumber-in-raleigh", tags: [] };
const weekly = { scanIntervalDays: 7, centroidIntervalDays: 1, repeats: 1 };

function plan(overrides: Partial<PlanInput>) {
	return planRuns({
		targets: [],
		prompts: [nearMe, cityNamed],
		points: [...grid, centroid, zip],
		cadence: weekly,
		getProvider,
		...overrides,
	});
}

const seriesOf = (result: ReturnType<typeof planRuns>, engine: string) =>
	result.series
		.filter((s) => s.engine === engine)
		.map((s) => ({
			provider: s.config.provider,
			tier: s.tier,
			kind: s.pointKind,
			points: s.pointIds.length,
			prompts: s.promptIds,
			intervalDays: s.intervalDays,
		}));

describe("planRuns", () => {
	it("runs near-me prompts on the grid and every prompt on centroids for a point-level route", () => {
		expect(seriesOf(plan({ targets: [target("google-ai-mode:dataforseo")] }), "google-ai-mode")).toEqual([
			{ provider: "dataforseo", tier: "T1", kind: "grid", points: 9, prompts: [nearMe.id], intervalDays: 7 },
			{
				provider: "dataforseo",
				tier: "T1",
				kind: "centroid",
				points: 1,
				prompts: [nearMe.id, cityNamed.id],
				intervalDays: 1,
			},
		]);
	});

	it("runs only city-named prompts on centroids for an engine with no route below T5", () => {
		expect(seriesOf(plan({ targets: [target("chatgpt:brightdata")] }), "chatgpt")).toEqual([
			{ provider: "brightdata", tier: "T5", kind: "centroid", points: 1, prompts: [cityNamed.id], intervalDays: 7 },
		]);
	});

	it("runs Claude on centroids at T4, near-me prompts included", () => {
		expect(seriesOf(plan({ targets: [target("claude:anthropic-api:claude-sonnet-5")] }), "claude")).toEqual([
			{
				provider: "anthropic-api",
				tier: "T4",
				kind: "centroid",
				points: 1,
				prompts: [nearMe.id, cityNamed.id],
				intervalDays: 7,
			},
		]);
	});

	it("falls back to the next route for a point the best route can't serve", () => {
		const unnamed = point("centroid", { googleCanonicalName: null });
		const result = plan({ targets: [target("google-ai-mode:cloro")], points: [centroid, unnamed] });
		expect(seriesOf(result, "google-ai-mode")).toEqual([
			{ provider: "cloro", tier: "T1", kind: "centroid", points: 1, prompts: [nearMe.id, cityNamed.id], intervalDays: 1 },
			{ provider: "cloro", tier: "T5", kind: "centroid", points: 1, prompts: [cityNamed.id], intervalDays: 7 },
		]);
	});

	it("falls back past a degraded route", () => {
		const result = plan({
			targets: [target("google-ai-mode:dataforseo"), target("google-ai-mode:cloro")],
			isDegraded: (route) => route.config.provider === "dataforseo",
		});
		expect(seriesOf(result, "google-ai-mode")).toEqual([
			{ provider: "cloro", tier: "T1", kind: "centroid", points: 1, prompts: [nearMe.id, cityNamed.id], intervalDays: 1 },
		]);
	});

	it("falls back to a city-named prompt when a centroid has no city to send", () => {
		const result = plan({
			targets: [target("claude:anthropic-api:claude-sonnet-5")],
			points: [point("centroid", { city: null })],
		});
		expect(seriesOf(result, "claude")).toEqual([
			{ provider: "anthropic-api", tier: "T5", kind: "centroid", points: 1, prompts: [cityNamed.id], intervalDays: 7 },
		]);
	});

	it("reports grid points no configured route can place", () => {
		const result = plan({ targets: [target("google-ai-overview:searchapi")], points: [grid[0] as PlannerPoint] });
		expect(result.uncovered).toEqual([
			{
				engine: "google-ai-overview",
				pointId: grid[0]?.id,
				pointLabel: grid[0]?.label,
				reasons: [expect.stringMatching(/doesn't place/)],
			},
		]);
		expect(result.series).toEqual([]);
	});

	it("runs centroids daily only on the two cheapest T1 routes", () => {
		const result = plan({
			targets: [
				target("google-ai-mode:dataforseo"),
				target("google-ai-overview:dataforseo"),
				target("claude:anthropic-api:claude-sonnet-5"),
			],
		});
		const centroidCadence = Object.fromEntries(
			result.series.filter((s) => s.pointKind === "centroid").map((s) => [s.engine, s.intervalDays]),
		);
		expect(centroidCadence).toEqual({ "google-ai-mode": 1, "google-ai-overview": 1, claude: 7 });
	});

	it("projects monthly runs and cost from points, prompts, repeats and cadence", () => {
		const result = plan({
			targets: [target("google-ai-mode:dataforseo")],
			cadence: { scanIntervalDays: 7, centroidIntervalDays: 1, repeats: 2 },
		});
		// Grid: 9 points × 1 prompt × 2 repeats × 30/7. Centroid: 1 point × 2 prompts × 2 repeats × 30.
		const runs = 9 * 2 * (30 / 7) + 2 * 2 * 30;
		expect(result.runsPerMonth).toBeCloseTo(runs);
		expect(result.costPerMonthUsd).toBeCloseTo(runs * 0.004);
		expect(result.unpricedRunsPerMonth).toBe(0);
	});
});

describe("budgetRefusal", () => {
	const located = plan({ targets: [target("google-ai-mode:dataforseo")] });

	it("accepts a plan within budget", () => {
		expect(budgetRefusal(located, 5)).toBeNull();
	});

	it("refuses a plan over budget", () => {
		expect(budgetRefusal(located, 0.1)).toMatch(/over the \$0\.10 budget/);
	});

	it("refuses without a budget", () => {
		expect(budgetRefusal(located, null)).toMatch(/Set a monthly budget/);
	});

	it("refuses a plan it can't price", () => {
		expect(budgetRefusal(plan({ targets: [target("chatgpt:unpriced")] }), 1000)).toMatch(/no cost estimate for unpriced/);
	});
});
