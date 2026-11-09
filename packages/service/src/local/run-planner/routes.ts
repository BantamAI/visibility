import type { FidelityTier, ModelConfig } from "@workspace/lib/providers";
import { estimateRunCostUsd } from "@workspace/lib/usage";
import type { SamplePointKind } from "../schema";

export interface RouteSpec {
	provider: string;
	tier: FidelityTier;
	/** City-level routes can't place a run at a grid point, so they take centroids only. */
	pointKinds: readonly SamplePointKind[];
}

/**
 * Best first, as SP5-L chose them (`docs/local/sp5-l-results.md`). An engine missing
 * here has no route below T5: it runs city-named prompts on centroids through
 * whichever provider is configured for it.
 */
export const ROUTING_TABLE: Readonly<Record<string, readonly RouteSpec[]>> = {
	"google-ai-mode": [
		{ provider: "dataforseo", tier: "T1", pointKinds: ["grid", "centroid"] },
		{ provider: "cloro", tier: "T1", pointKinds: ["centroid"] },
	],
	"google-ai-overview": [
		{ provider: "dataforseo", tier: "T1", pointKinds: ["grid", "centroid"] },
		{ provider: "searchapi", tier: "T1", pointKinds: ["grid", "centroid"] },
		{ provider: "cloro", tier: "T1", pointKinds: ["centroid"] },
	],
	claude: [{ provider: "anthropic-api", tier: "T4", pointKinds: ["centroid"] }],
};

const PROMPT_ONLY: Omit<RouteSpec, "provider"> = { tier: "T5", pointKinds: ["centroid"] };

/** Measured in SP5-L, where the coarse per-provider estimate is far off. */
const MEASURED_COST_PER_RUN_USD: Readonly<Record<string, number>> = {
	"google-ai-mode:dataforseo": 0.004,
	"google-ai-overview:dataforseo": 0.004,
	"claude:anthropic-api": 0.04,
};

export function costPerRunUsd(config: ModelConfig): number | null {
	return (
		MEASURED_COST_PER_RUN_USD[`${config.model}:${config.provider}`] ??
		estimateRunCostUsd(config.provider, config.webSearch)
	);
}

export interface PlannerRoute {
	config: ModelConfig;
	tier: FidelityTier;
	pointKinds: readonly SamplePointKind[];
	costPerRunUsd: number | null;
}

/**
 * The one route an engine runs on: the best configured one. It never changes from run
 * to run, so an engine's results stay one measurement; a different route is a new series.
 */
export function routeFor(engine: string, targets: readonly ModelConfig[]): PlannerRoute | null {
	const configured = targets.filter((target) => target.model === engine);
	const located = (ROUTING_TABLE[engine] ?? []).flatMap((spec) =>
		configured
			.filter((config) => config.provider === spec.provider)
			.map((config) => ({ config, tier: spec.tier, pointKinds: spec.pointKinds })),
	);
	const route = located[0] ?? configured.map((config) => ({ config, ...PROMPT_ONLY }))[0];
	return route ? { ...route, costPerRunUsd: costPerRunUsd(route.config) } : null;
}
