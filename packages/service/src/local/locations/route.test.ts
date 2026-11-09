import type { LocationSupport, ModelConfig, Provider, RunLocation } from "@workspace/lib/providers";
import { describe, expect, it } from "vitest";
import { LocationNotHonouredError, providerOptionsFor, runLocationRecord } from "./route";

const raleigh: RunLocation = {
	pointId: "30000000-0000-0000-0000-000000000001",
	latitude: 35.78,
	longitude: -78.64,
	city: "Raleigh",
	region: "NC",
	country: "US",
	timezone: "America/New_York",
};

function provider(id: string, support?: Record<string, LocationSupport[]>): Provider {
	return {
		id,
		name: id,
		access: "scraped",
		isConfigured: () => true,
		run: async () => ({ rawOutput: {}, webQueries: [] }),
		...(support ? { locationSupport: (config: ModelConfig) => support[config.model] ?? [] } : {}),
	};
}

const coordinates = provider("dataforseo", { "google-ai-mode": [{ tier: "T1", reads: ["latitude", "longitude"] }] });
const canonical = provider("cloro", { "google-ai-mode": [{ tier: "T1", reads: ["googleCanonicalName"] }] });
const countryOnly = provider("searchapi");
const providers: Record<string, Provider> = { dataforseo: coordinates, cloro: canonical, searchapi: countryOnly };

const target = (provider: string, model = "google-ai-mode"): ModelConfig => ({ model, provider, webSearch: true });

describe("providerOptionsFor", () => {
	it("sends brand-mode runs exactly the options they always had", () => {
		expect(providerOptionsFor(coordinates, { ...target("dataforseo"), version: "v1" }, undefined)).toStrictEqual({
			webSearch: true,
			version: "v1",
		});
	});

	it("passes the location and tier to a provider that declares them", () => {
		expect(providerOptionsFor(coordinates, target("dataforseo"), { location: raleigh, tier: "T1" })).toStrictEqual({
			webSearch: true,
			version: undefined,
			location: raleigh,
			locationTier: "T1",
		});
	});

	it("refuses a tier the provider doesn't serve instead of running without it", () => {
		expect(() => providerOptionsFor(countryOnly, target("searchapi"), { location: raleigh, tier: "T1" })).toThrow(
			LocationNotHonouredError,
		);
		expect(() =>
			providerOptionsFor(coordinates, target("dataforseo", "chatgpt"), { location: raleigh, tier: "T1" }),
		).toThrow(/doesn't place chatgpt runs at T1/);
	});

	it("refuses a point missing a field the tier sends", () => {
		expect(() => providerOptionsFor(canonical, target("cloro"), { location: raleigh, tier: "T1" })).toThrow(
			/has no googleCanonicalName/,
		);
	});

	it("runs a city-named prompt anywhere, sending no location", () => {
		expect(providerOptionsFor(countryOnly, target("searchapi"), { location: raleigh, tier: "T5" })).toStrictEqual({
			webSearch: true,
			version: undefined,
		});
	});
});

describe("runLocationRecord", () => {
	const base = { runId: "r", subjectId: "s", request: { location: raleigh, tier: "T1" as const } };

	it("records the method the tier implies and the vendor's own cost and run id", () => {
		const record = runLocationRecord({
			...base,
			config: target("dataforseo"),
			result: {
				rawOutput: {},
				webQueries: [],
				costUsd: 0.0021,
				vendorRunId: "task-1",
				vendorReportedLocation: { code: 1 },
			},
		});
		expect(record).toMatchObject({
			pointId: raleigh.pointId,
			requestedLocation: raleigh,
			locationMethod: "geo_coordinate",
			fidelityTier: "T1",
			vendorRunId: "task-1",
			vendorReportedLocation: { code: 1 },
			costUsd: "0.002100",
			costSource: "vendor",
		});
	});

	it("falls back to the provider's estimate when the vendor reports no cost", () => {
		const record = runLocationRecord({
			...base,
			config: target("searchapi"),
			result: { rawOutput: {}, webQueries: [] },
		});
		expect(record).toMatchObject({ costUsd: "0.004000", costSource: "estimate", vendorRunId: null });
	});
});
