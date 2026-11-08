import type { ModelConfig } from "@workspace/config/scrape-targets";
import type { z } from "zod";

export type { ModelConfig };

/** Text and citations are re-derived from `rawOutput` on every replay, so it must keep whatever extraction reads. */
export interface ScrapeResult {
	rawOutput: unknown;
	webQueries: string[];
	modelVersion?: string;
	/** The vendor's own id for the run, when it gives one. */
	vendorRunId?: string;
	/** Where the vendor says the run came from, when it says. */
	vendorReportedLocation?: Record<string, unknown>;
	/** What the vendor billed for the run, when the response says. */
	costUsd?: number;
}

/**
 * How closely a run reproduces where a real person asks from, best first. The
 * method each tier sends a location by is fixed; see ADR-33.
 */
export type FidelityTier = "T1" | "T2" | "T3" | "T4" | "T5";

/** A sample point to fetch an answer as if from, resolved in advance so adapters never geocode. */
export interface RunLocation {
	pointId: string;
	latitude: number;
	longitude: number;
	/** Missing for a point no place is near. */
	city?: string;
	/** State or region code: "NC". */
	region?: string;
	/** ISO 3166-1 alpha-2, upper case. */
	country: string;
	postalCode?: string;
	/** IANA zone. */
	timezone: string;
	/** Google's geotargeting name: "Raleigh,North Carolina,United States". */
	googleCanonicalName?: string;
	uule?: string;
}

/** One tier a surface can serve, and the location fields it sends at that tier. */
export interface LocationSupport {
	tier: FidelityTier;
	reads: readonly (keyof RunLocation)[];
}

export interface ProviderOptions {
	webSearch?: boolean;
	version?: string;
	/** Given only at a tier `locationSupport` lists for the model, with every field it reads. */
	location?: RunLocation;
	locationTier?: FidelityTier;
}

export interface StructuredResearchOptions<T> {
	prompt: string;
	schema: z.ZodType<T>;
	/** Defaults to true. False for a single completion over context supplied in the prompt. */
	webSearch?: boolean;
}

export interface StructuredResearchResult<T> {
	object: T;
	/** After any `:online` suffixing. */
	modelVersion?: string;
}

/**
 * "scraped" reads back the consumer product, surface and all (ads, shopping,
 * the citations a user sees); "api" is the model's own answer, grounded only
 * when its search tool is on.
 */
export type ProviderAccess = "scraped" | "api";

export interface Provider {
	id: string;
	name: string;
	access: ProviderAccess;
	/** For a provider offering both paths, like DataForSEO, which uses its API when a target pins a version. */
	accessFor?(config: ModelConfig): ProviderAccess;
	/** Anchor in the provider setup guide; omitted by the test stub. */
	docsAnchor?: string;
	isConfigured(): boolean;
	run(model: string, prompt: string, options?: ProviderOptions): Promise<ScrapeResult>;
	/** The tiers below T5 the model's surface can serve. Omitted when it sends no location below country. */
	locationSupport?(model: string): readonly LocationSupport[];
	/** An error message for a target this provider can't serve. Omitted by providers that accept any model. */
	validateTarget?(config: ModelConfig): string | null;

	/** Direct API providers only; a deployment needs at least one. */
	runStructuredResearch?<T>(options: StructuredResearchOptions<T>): Promise<StructuredResearchResult<T>>;
}

export interface TestResult {
	success: boolean;
	latencyMs: number;
	error?: string;
	sampleOutput?: string;
}
