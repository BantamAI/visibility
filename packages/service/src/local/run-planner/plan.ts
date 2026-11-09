import type { FidelityTier, ModelConfig, Provider } from "@workspace/lib/providers";
import { PROJECTION_DAYS_PER_MONTH } from "@workspace/lib/usage";
import { pickRoute } from "../locations/route";
import { toRunLocation } from "../locations/run-location";
import type { SamplePoint, SamplePointKind } from "../schema";
import { NEAR_ME_TAG } from "./constants";
import { type PlannerRoute, routesFor } from "./routes";

export interface RunCadence {
	/** Days between full scans: every point of every route. */
	scanIntervalDays: number;
	/** Days between centroid runs on the two cheapest T1 routes, which run more often than full scans. */
	centroidIntervalDays: number;
	repeats: number;
}

export type PlannerPoint = Pick<
	SamplePoint,
	| "id"
	| "kind"
	| "label"
	| "lat"
	| "lng"
	| "city"
	| "region"
	| "country"
	| "postalCode"
	| "timezone"
	| "googleCanonicalName"
>;

export interface PlanInput {
	/** The subject's picked targets. */
	targets: readonly ModelConfig[];
	prompts: readonly { id: string; tags: readonly string[] }[];
	/** Active points only. */
	points: readonly PlannerPoint[];
	cadence: RunCadence;
	getProvider: (id: string) => Provider;
	/** Routes the canaries have marked degraded; the planner falls back past them. */
	isDegraded?: (route: PlannerRoute) => boolean;
}

export interface PlannedSeries {
	engine: string;
	config: ModelConfig;
	tier: FidelityTier;
	pointKind: SamplePointKind;
	pointIds: string[];
	promptIds: string[];
	intervalDays: number;
	repeats: number;
	runsPerMonth: number;
	costPerRunUsd: number | null;
	costPerMonthUsd: number | null;
}

export interface UncoveredPoint {
	engine: string;
	pointId: string;
	pointLabel: string;
	reasons: string[];
}

export interface RunPlan {
	series: PlannedSeries[];
	uncovered: UncoveredPoint[];
	runsPerMonth: number;
	/** Of the runs that have a cost estimate. */
	costPerMonthUsd: number;
	unpricedRunsPerMonth: number;
}

const CHEAP_T1_ROUTES = 2;

function promptsFor(tier: FidelityTier, kind: SamplePointKind, input: PlanInput): string[] {
	const nearMe = (prompt: PlanInput["prompts"][number]) => prompt.tags.includes(NEAR_ME_TAG);
	// A T5 run sends no location, so a "near me" prompt there would measure wherever the vendor's server is.
	if (tier === "T5") return input.prompts.filter((p) => !nearMe(p)).map((p) => p.id);
	if (kind !== "centroid") return input.prompts.filter(nearMe).map((p) => p.id);
	return input.prompts.map((p) => p.id);
}

function routeKey(engine: string, route: PlannerRoute, kind: SamplePointKind): string {
	const { provider, version, webSearch } = route.config;
	return [engine, provider, version ?? "", webSearch, route.tier, kind].join("|");
}

interface RouteGroup {
	engine: string;
	route: PlannerRoute;
	kind: SamplePointKind;
	pointIds: string[];
}

/** Each point takes the best route that can serve it, so a point missing a field the best route sends falls back. */
function assignRoutes(input: PlanInput): { groups: RouteGroup[]; uncovered: UncoveredPoint[] } {
	const groups = new Map<string, RouteGroup>();
	const uncovered: UncoveredPoint[] = [];
	for (const engine of new Set(input.targets.map((target) => target.model))) {
		const routes = routesFor(engine, input.targets).filter((route) => !input.isDegraded?.(route));
		for (const point of input.points) {
			const eligible = routes.filter((route) => route.pointKinds.includes(point.kind));
			if (eligible.length === 0) continue;
			const { route, refused } = pickRoute(eligible, toRunLocation(point), input.getProvider);
			if (!route) {
				uncovered.push({ engine, pointId: point.id, pointLabel: point.label, reasons: refused.map((r) => r.reason) });
				continue;
			}
			const key = routeKey(engine, route, point.kind);
			const group = groups.get(key) ?? { engine, route, kind: point.kind, pointIds: [] };
			group.pointIds.push(point.id);
			groups.set(key, group);
		}
	}
	return { groups: [...groups.values()], uncovered };
}

function cheapestT1Engines(groups: readonly RouteGroup[]): Set<string> {
	const cost = (group: RouteGroup) => group.route.costPerRunUsd ?? Number.POSITIVE_INFINITY;
	const engines = groups
		.filter((group) => group.kind === "centroid" && group.route.tier === "T1")
		.sort((a, b) => cost(a) - cost(b) || a.engine.localeCompare(b.engine))
		.map((group) => group.engine);
	return new Set([...new Set(engines)].slice(0, CHEAP_T1_ROUTES));
}

/** Expands a subject's prompts × engines × points × repeats into the series a schedule runs. */
export function planRuns(input: PlanInput): RunPlan {
	const { groups, uncovered } = assignRoutes(input);
	const cheapT1Engines = cheapestT1Engines(groups);
	const { cadence } = input;

	const series: PlannedSeries[] = [];
	for (const { engine, route, kind, pointIds } of groups) {
		const promptIds = promptsFor(route.tier, kind, input);
		if (promptIds.length === 0) continue;
		const runsOften = kind === "centroid" && route.tier === "T1" && cheapT1Engines.has(engine);
		const intervalDays = runsOften ? cadence.centroidIntervalDays : cadence.scanIntervalDays;
		const runsPerMonth =
			pointIds.length * promptIds.length * cadence.repeats * (PROJECTION_DAYS_PER_MONTH / intervalDays);
		series.push({
			engine,
			config: route.config,
			tier: route.tier,
			pointKind: kind,
			pointIds,
			promptIds,
			intervalDays,
			repeats: cadence.repeats,
			runsPerMonth,
			costPerRunUsd: route.costPerRunUsd,
			costPerMonthUsd: route.costPerRunUsd === null ? null : route.costPerRunUsd * runsPerMonth,
		});
	}

	return {
		series,
		uncovered,
		runsPerMonth: series.reduce((sum, s) => sum + s.runsPerMonth, 0),
		costPerMonthUsd: series.reduce((sum, s) => sum + (s.costPerMonthUsd ?? 0), 0),
		unpricedRunsPerMonth: series.reduce((sum, s) => sum + (s.costPerMonthUsd === null ? s.runsPerMonth : 0), 0),
	};
}

/** Why the plan can't be enabled under this budget, or null when it fits. */
export function budgetRefusal(plan: RunPlan, monthlyBudgetUsd: number | null): string | null {
	if (monthlyBudgetUsd === null) return "Set a monthly budget before enabling the schedule.";
	if (plan.unpricedRunsPerMonth > 0) {
		const providers = [...new Set(plan.series.filter((s) => s.costPerRunUsd === null).map((s) => s.config.provider))];
		return `There's no cost estimate for ${providers.join(", ")}, so the plan can't be checked against the budget.`;
	}
	if (plan.costPerMonthUsd > monthlyBudgetUsd) {
		return `The plan costs about $${plan.costPerMonthUsd.toFixed(2)} a month, over the $${monthlyBudgetUsd.toFixed(2)} budget.`;
	}
	return null;
}
