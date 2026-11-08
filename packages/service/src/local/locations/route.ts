import type {
	FidelityTier,
	ModelConfig,
	Provider,
	ProviderOptions,
	RunLocation,
	ScrapeResult,
} from "@workspace/lib/providers";
import { estimateRunCostUsd } from "@workspace/lib/usage";
import type { locationMethod, RunLocationRecord } from "../schema";

export type LocationMethod = (typeof locationMethod.enumValues)[number];

export const TIER_METHODS: Record<FidelityTier, LocationMethod> = {
	T1: "geo_coordinate",
	T2: "egress_city",
	T3: "egress_region",
	T4: "api_user_location",
	T5: "prompt_only",
};

export interface LocationRequest {
	location: RunLocation;
	tier: FidelityTier;
}

export class LocationNotHonouredError extends Error {
	constructor(
		readonly config: ModelConfig,
		readonly tier: FidelityTier,
		readonly reason: string,
	) {
		super(`${config.model}:${config.provider} can't run at ${tier}: ${reason}`);
		this.name = "LocationNotHonouredError";
	}
}

/**
 * Why the provider can't serve this request, or null when it can. T5 names the city
 * in the prompt and sends no location, so every surface serves it.
 */
export function whyNotHonoured(provider: Provider, model: string, request: LocationRequest): string | null {
	if (request.tier === "T5") return null;
	const support = provider.locationSupport?.(model).find((entry) => entry.tier === request.tier);
	if (!support) return `${provider.name} doesn't place ${model} runs at ${request.tier}`;
	const missing = support.reads.filter((field) => request.location[field] === undefined);
	if (missing.length > 0) return `point ${request.location.pointId} has no ${missing.join(", ")}`;
	return null;
}

/**
 * The options for one run, refusing before anything is spent when the provider can't
 * honour the requested tier. Without a request this is exactly what brand-mode runs send.
 */
export function providerOptionsFor(
	provider: Provider,
	config: ModelConfig,
	request: LocationRequest | undefined,
): ProviderOptions {
	const options: ProviderOptions = { webSearch: config.webSearch, version: config.version };
	if (!request) return options;
	const reason = whyNotHonoured(provider, config.model, request);
	if (reason) throw new LocationNotHonouredError(config, request.tier, reason);
	if (request.tier === "T5") return options;
	return { ...options, location: request.location, locationTier: request.tier };
}

export interface RouteCandidate {
	config: ModelConfig;
	tier: FidelityTier;
}

/** The first candidate that can serve the location, with why each one before it couldn't. */
export function pickRoute<C extends RouteCandidate>(
	candidates: readonly C[],
	location: RunLocation,
	getProvider: (id: string) => Provider,
): { route: C | null; refused: { candidate: C; reason: string }[] } {
	const refused: { candidate: C; reason: string }[] = [];
	for (const candidate of candidates) {
		const reason = whyNotHonoured(getProvider(candidate.config.provider), candidate.config.model, {
			location,
			tier: candidate.tier,
		});
		if (!reason) return { route: candidate, refused };
		refused.push({ candidate, reason });
	}
	return { route: null, refused };
}

/** The vendor's cost when the response gives one, else the coarse per-provider estimate. */
export function runCost(
	config: ModelConfig,
	result: ScrapeResult,
): { usd: number; source: "vendor" | "estimate" } | null {
	if (result.costUsd !== undefined) return { usd: result.costUsd, source: "vendor" };
	const estimate = estimateRunCostUsd(config.provider, config.webSearch);
	return estimate === null ? null : { usd: estimate, source: "estimate" };
}

export function runLocationRecord(input: {
	runId: string;
	subjectId: string;
	config: ModelConfig;
	request: LocationRequest;
	result: ScrapeResult;
}): RunLocationRecord {
	const cost = runCost(input.config, input.result);
	return {
		runId: input.runId,
		subjectId: input.subjectId,
		pointId: input.request.location.pointId,
		requestedLocation: input.request.location,
		locationMethod: TIER_METHODS[input.request.tier],
		fidelityTier: input.request.tier,
		vendorReportedLocation: input.result.vendorReportedLocation ?? null,
		vendorRunId: input.result.vendorRunId ?? null,
		costUsd: cost === null ? null : cost.usd.toFixed(6),
		costSource: cost?.source ?? null,
	};
}
