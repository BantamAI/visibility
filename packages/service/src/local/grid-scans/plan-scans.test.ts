import type { LocationSupport, ModelConfig, Provider } from "@workspace/lib/providers";
import { describe, expect, it } from "vitest";
import { cityTag, NEAR_ME_TAG, type PlannerPoint, planRuns } from "../run-planner";
import { dueScans, EARLY_START_MS, scansFor, specKey } from "./plan-scans";

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

const providers: Record<string, Provider> = {
	dataforseo: provider("dataforseo", { "google-ai-mode": [{ tier: "T1", reads: ["latitude", "longitude"] }] }),
	cloro: provider("cloro", { "google-ai-mode": [{ tier: "T1", reads: ["googleCanonicalName"] }] }),
	brightdata: provider("brightdata"),
};
const getProvider = (id: string) => providers[id] as Provider;
const target = (model: string, provider: string): ModelConfig => ({ model, provider, webSearch: true });

let nextPoint = 0;
function point(kind: PlannerPoint["kind"], areaId: string, fields: Partial<PlannerPoint> = {}): PlannerPoint {
	nextPoint += 1;
	return {
		id: `point-${nextPoint}`,
		areaId,
		kind,
		label: `${kind} ${nextPoint}`,
		lat: 35.78 + nextPoint / 100,
		lng: -78.64,
		city: "Raleigh",
		region: "NC",
		country: "US",
		postalCode: null,
		timezone: "America/New_York",
		googleCanonicalName: "Raleigh,North Carolina,United States",
		...fields,
	};
}

const raleighGrid = Array.from({ length: 9 }, () => point("grid", "raleigh"));
const durhamGrid = Array.from({ length: 4 }, () => point("grid", "durham"));
const raleigh = point("centroid", "raleigh");
const cary = point("centroid", "raleigh", { label: "Cary", googleCanonicalName: null });
const durham = point("centroid", "durham");
const points = [...raleighGrid, ...durhamGrid, raleigh, cary, durham];

const nearMe = { id: "near-me", tags: [NEAR_ME_TAG] };
const cityNamed = { id: "in-raleigh", tags: [] };
const cadence = { scanIntervalDays: 7, centroidIntervalDays: 1, repeats: 2 };

function scans(targets: ModelConfig[]) {
	return scansFor(planRuns({ targets, prompts: [nearMe, cityNamed], points, cadence, getProvider }), points);
}

const summary = (specs: ReturnType<typeof scans>) =>
	specs.map(
		(s) => `${s.config.model}/${s.config.provider} ${s.pointKind} ${s.areaId} ${s.promptId}: ${s.points.length}`,
	);

describe("scansFor", () => {
	it("makes one scan per area, prompt and point kind, on the engine's one route", () => {
		expect(summary(scans([target("google-ai-mode", "dataforseo"), target("google-ai-mode", "cloro")])).sort()).toEqual([
			"google-ai-mode/dataforseo centroid durham in-raleigh: 1",
			"google-ai-mode/dataforseo centroid durham near-me: 1",
			"google-ai-mode/dataforseo centroid raleigh in-raleigh: 2",
			"google-ai-mode/dataforseo centroid raleigh near-me: 2",
			"google-ai-mode/dataforseo grid durham near-me: 4",
			"google-ai-mode/dataforseo grid raleigh near-me: 9",
		]);
	});

	it("runs a city-level route on centroids only", () => {
		const specs = scans([target("google-ai-mode", "cloro")]);
		expect(new Set(specs.map((s) => s.pointKind))).toEqual(new Set(["centroid"]));
	});

	it("runs an engine with no located route on centroids, with city-named prompts only", () => {
		expect(summary(scans([target("chatgpt", "brightdata")])).sort()).toEqual([
			"chatgpt/brightdata centroid durham in-raleigh: 1",
			"chatgpt/brightdata centroid raleigh in-raleigh: 2",
		]);
	});

	it("records a point the route can't place with the nearest city in its area standing in", () => {
		const raleighScan = scans([target("google-ai-mode", "cloro")]).find((s) => s.areaId === "raleigh");
		expect(raleighScan?.points.map((p) => p.id)).toEqual([raleigh.id]);
		expect(raleighScan?.uncovered).toEqual([
			expect.objectContaining({ pointId: cary.id, label: "Cary", lat: cary.lat, standInPointId: raleigh.id }),
		]);
	});

	it("prices each scan as its points × repeats at the route's cost per run", () => {
		const grid = scans([target("google-ai-mode", "dataforseo")]).find(
			(s) => s.pointKind === "grid" && s.areaId === "raleigh",
		);
		expect(grid?.estimatedCostUsd).toBeCloseTo(9 * 2 * 0.004);
	});
});

describe("scansFor with prompts that name a city", () => {
	const raleighCity = point("centroid", "triangle", { label: "Raleigh" });
	const caryCity = point("centroid", "triangle", { label: "Cary", city: "Cary" });
	const garner = point("centroid", "triangle", { label: "Garner", city: "Garner", googleCanonicalName: null });
	const triangleGrid = Array.from({ length: 4 }, () => point("grid", "triangle"));
	const trianglePoints = [...triangleGrid, raleighCity, caryCity, garner];
	const inCary = { id: "in-cary", tags: [cityTag("Cary", "NC")] };
	const inGarner = { id: "in-garner", tags: [cityTag("Garner", "NC")] };
	const inDenver = { id: "in-denver", tags: [cityTag("Denver", "CO")] };

	const scoped = (targets: ModelConfig[]) =>
		scansFor(
			planRuns({
				targets,
				prompts: [nearMe, inCary, inGarner, inDenver],
				points: trianglePoints,
				cadence,
				getProvider,
			}),
			trianglePoints,
		);

	it("runs a city-named prompt on that city's centroid only, never on the grid", () => {
		expect(summary(scoped([target("google-ai-mode", "dataforseo")])).sort()).toEqual([
			"google-ai-mode/dataforseo centroid triangle in-cary: 1",
			"google-ai-mode/dataforseo centroid triangle in-garner: 1",
			"google-ai-mode/dataforseo centroid triangle near-me: 3",
			"google-ai-mode/dataforseo grid triangle near-me: 4",
		]);
		const cary = scoped([target("google-ai-mode", "dataforseo")]).find((s) => s.promptId === "in-cary");
		expect(cary?.points.map((p) => p.id)).toEqual([caryCity.id]);
	});

	it("runs a city the route can't place at the centroid standing in for it", () => {
		const specs = scoped([target("google-ai-mode", "cloro")]);
		const garnerScan = specs.find((s) => s.promptId === "in-garner");
		expect(garnerScan?.points).toHaveLength(1);
		expect(garnerScan?.uncovered).toEqual([expect.objectContaining({ pointId: garner.id })]);
		expect(specs.find((s) => s.promptId === "in-cary")?.uncovered).toEqual([]);
	});

	it("runs city-named prompts at T5, where near-me prompts don't run", () => {
		expect(summary(scoped([target("chatgpt", "brightdata")])).sort()).toEqual([
			"chatgpt/brightdata centroid triangle in-cary: 1",
			"chatgpt/brightdata centroid triangle in-garner: 1",
		]);
	});

	it("counts only the runs a city-named prompt makes", () => {
		const plan = planRuns({
			targets: [target("chatgpt", "brightdata")],
			prompts: [inCary, inDenver],
			points: trianglePoints,
			cadence: { ...cadence, repeats: 1 },
			getProvider,
		});
		expect(plan.series[0]?.promptIds).toEqual(["in-cary"]);
		expect(plan.runsPerMonth).toBeCloseTo(30 / 7);
	});
});

describe("dueScans", () => {
	const specs = scans([target("google-ai-mode", "dataforseo")]);
	const now = new Date("2026-11-09T12:00:00Z");
	const daysAgo = (days: number, extraMs = 0) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000 - extraMs);

	it("starts every scan that has never run", () => {
		expect(dueScans(specs, new Map(), now)).toHaveLength(specs.length);
	});

	it("waits for each series' own interval", () => {
		const last = new Map(specs.map((s) => [specKey(s), daysAgo(1)]));
		const due = dueScans(specs, last, now);
		expect(due.length).toBeGreaterThan(0);
		expect(due.every((s) => s.pointKind === "centroid" && s.intervalDays === 1)).toBe(true);
	});

	it("starts a scan slightly early rather than a tick late", () => {
		const almostAWeek = new Map(specs.map((s) => [specKey(s), daysAgo(7, -EARLY_START_MS / 2)]));
		expect(dueScans(specs, almostAWeek, now)).toHaveLength(specs.length);
		const sixDays = new Map(specs.map((s) => [specKey(s), daysAgo(6)]));
		expect(dueScans(specs, sixDays, now).some((s) => s.pointKind === "grid")).toBe(false);
	});

	it("starts a new series at once when the engine's route changes", () => {
		const onCloro = new Map(scans([target("google-ai-mode", "cloro")]).map((s) => [specKey(s), daysAgo(0)] as const));
		expect(dueScans(specs, onCloro, now)).toHaveLength(specs.length);
	});
});
