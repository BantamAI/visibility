import type { FidelityTier, ModelConfig, Provider } from "@workspace/lib/providers";
import { PROJECTION_DAYS_PER_MONTH } from "@workspace/lib/usage";
import { whyNotHonoured } from "../locations/route";
import { toRunLocation } from "../locations/run-location";
import type { SamplePoint, SamplePointKind } from "../schema";
import { distanceMeters } from "../service-areas/geo";
import { NEAR_ME_TAG } from "./constants";
import { type PlannerRoute, routeFor } from "./routes";

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
	| "areaId"
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
	/** Routes the canaries have marked degraded. Their engine pauses rather than switching routes. */
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

/**
 * A point the engine's route can't place. It takes the results of the nearest city
 * centroid in its area that the route can place, which is already in the plan, so it
 * adds no runs. With no such centroid, `standIn` is null and the point is a gap.
 */
export interface UncoveredPoint {
	engine: string;
	pointId: string;
	pointLabel: string;
	reason: string;
	standIn: { pointId: string; pointLabel: string } | null;
}

export interface PausedEngine {
	engine: string;
	config: ModelConfig;
	tier: FidelityTier;
}

export interface RunPlan {
	series: PlannedSeries[];
	uncovered: UncoveredPoint[];
	paused: PausedEngine[];
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

interface RouteGroup {
	engine: string;
	route: PlannerRoute;
	kind: SamplePointKind;
	pointIds: string[];
}

function nearestStandIn(point: PlannerPoint, served: readonly PlannerPoint[]): PlannerPoint | null {
	let best: { point: PlannerPoint; meters: number } | null = null;
	for (const candidate of served) {
		if (candidate.kind !== "centroid" || candidate.areaId !== point.areaId) continue;
		const meters = distanceMeters(point, candidate);
		if (!best || meters < best.meters) best = { point: candidate, meters };
	}
	return best?.point ?? null;
}

function assignRoutes(input: PlanInput) {
	const groups: RouteGroup[] = [];
	const uncovered: UncoveredPoint[] = [];
	const paused: PausedEngine[] = [];
	for (const engine of new Set(input.targets.map((target) => target.model))) {
		const route = routeFor(engine, input.targets);
		if (!route) continue;
		if (input.isDegraded?.(route)) {
			paused.push({ engine, config: route.config, tier: route.tier });
			continue;
		}
		const provider = input.getProvider(route.config.provider);
		const served: PlannerPoint[] = [];
		const refused: { point: PlannerPoint; reason: string }[] = [];
		for (const point of input.points.filter((p) => route.pointKinds.includes(p.kind))) {
			const reason = whyNotHonoured(provider, route.config, { location: toRunLocation(point), tier: route.tier });
			if (reason) refused.push({ point, reason });
			else served.push(point);
		}
		for (const kind of new Set(served.map((point) => point.kind))) {
			const pointIds = served.filter((point) => point.kind === kind).map((point) => point.id);
			groups.push({ engine, route, kind, pointIds });
		}
		for (const { point, reason } of refused) {
			const standIn = nearestStandIn(point, served);
			uncovered.push({
				engine,
				pointId: point.id,
				pointLabel: point.label,
				reason,
				standIn: standIn && { pointId: standIn.id, pointLabel: standIn.label },
			});
		}
	}
	return { groups, uncovered, paused };
}

function cheapestT1Engines(groups: readonly RouteGroup[]): Set<string> {
	const cost = (group: RouteGroup) => group.route.costPerRunUsd ?? Number.POSITIVE_INFINITY;
	const engines = groups
		.filter((group) => group.kind === "centroid" && group.route.tier === "T1")
		.sort((a, b) => cost(a) - cost(b) || a.engine.localeCompare(b.engine))
		.map((group) => group.engine);
	return new Set([...new Set(engines)].slice(0, CHEAP_T1_ROUTES));
}

/**
 * Expands a subject's prompts × engines × points × repeats into the series a schedule
 * runs. Each engine runs on one route, so its results stay comparable over time.
 */
export function planRuns(input: PlanInput): RunPlan {
	const { groups, uncovered, paused } = assignRoutes(input);
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
		paused,
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
