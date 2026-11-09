import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractRun } from "../../text-extraction";
import type { RunLocation } from "../types";

const dataforseoClient = vi.hoisted(() => ({
	chatgptLlmResponsesLive: vi.fn(),
	perplexityLlmResponsesLive: vi.fn(),
	geminiLlmResponsesLive: vi.fn(),
	googleAiModeLiveAdvanced: vi.fn(),
	googleOrganicLiveAdvanced: vi.fn(),
	chatGptLlmScraperLiveAdvanced: vi.fn(),
	geminiLlmScraperLiveAdvanced: vi.fn(),
}));

vi.mock("dataforseo-client", () => ({
	AiOptimizationApi: class {
		chatGptLlmResponsesLive = dataforseoClient.chatgptLlmResponsesLive;
		perplexityLlmResponsesLive = dataforseoClient.perplexityLlmResponsesLive;
		geminiLlmResponsesLive = dataforseoClient.geminiLlmResponsesLive;
		chatGptLlmScraperLiveAdvanced = dataforseoClient.chatGptLlmScraperLiveAdvanced;
		geminiLlmScraperLiveAdvanced = dataforseoClient.geminiLlmScraperLiveAdvanced;
	},
	SerpApi: class {
		googleAiModeLiveAdvanced = dataforseoClient.googleAiModeLiveAdvanced;
		googleOrganicLiveAdvanced = dataforseoClient.googleOrganicLiveAdvanced;
	},
	SerpGoogleAiModeLiveAdvancedRequestInfo: class {
		constructor(args: Record<string, unknown>) {
			Object.assign(this, args);
		}
	},
	SerpGoogleOrganicLiveAdvancedRequestInfo: class {
		constructor(args: Record<string, unknown>) {
			Object.assign(this, args);
		}
	},
	AiOptimizationChatGptLlmResponsesLiveRequestInfo: class {
		constructor(args: Record<string, unknown>) {
			Object.assign(this, args);
		}
	},
	AiOptimizationPerplexityLlmResponsesLiveRequestInfo: class {
		constructor(args: Record<string, unknown>) {
			Object.assign(this, args);
		}
	},
	AiOptimizationGeminiLlmResponsesLiveRequestInfo: class {
		constructor(args: Record<string, unknown>) {
			Object.assign(this, args);
		}
	},
	AiOptimizationChatGptLlmScraperLiveAdvancedRequestInfo: class {
		constructor(args: Record<string, unknown>) {
			Object.assign(this, args);
		}
	},
	AiOptimizationGeminiLlmScraperLiveAdvancedRequestInfo: class {
		constructor(args: Record<string, unknown>) {
			Object.assign(this, args);
		}
	},
}));

import { extractCitations, extractTextContent } from "../../text-extraction";
import { dataforseo } from "./dataforseo";

/** What a run stores: extraction reads the payload, so a provider is right only if its payload yields this. */
const stored = (result: { rawOutput: unknown }) => extractRun(result.rawOutput, "dataforseo");

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const AI_OVERVIEW_OK = {
	tasks: [
		{
			status_code: 20000,
			status_message: "Ok.",
			result: [
				{
					items: [
						{ type: "organic", title: "some result" },
						{
							type: "ai_overview",
							markdown: "The Sonos Era 300 is a well-reviewed speaker released recently.",
							references: [{ url: "https://www.whathifi.com/reviews/sonos-era-300", title: "Sonos Era 300 review" }],
						},
					],
				},
			],
		},
	],
};

describe("dataforseo provider", () => {
	it("rejects prompts longer than DataForSEO's 500 character limit before calling the API", async () => {
		await expect(dataforseo.run("chatgpt", "x".repeat(501), { webSearch: true })).rejects.toThrow(
			/DataForSEO prompts must be 500 characters or fewer/,
		);

		expect(dataforseoClient.chatgptLlmResponsesLive).not.toHaveBeenCalled();
		expect(dataforseoClient.chatGptLlmScraperLiveAdvanced).not.toHaveBeenCalled();
	});

	describe("route selection", () => {
		function scraperResponse(result: Record<string, unknown>) {
			return { tasks: [{ status_code: 20000, status_message: "Ok.", result: [result] }] };
		}

		const CHATGPT_SCRAPE = {
			model: "gpt-5-5",
			markdown: "The JBL Xtreme 5 launched last month and reviewed well.",
			fan_out_queries: ["best speakers released July 2026"],
			sources: [{ url: "https://www.techradar.com/audio/jbl-xtreme-5", title: "JBL Xtreme 5 review" }],
			// Results the model was shown, not sources it cited — must not become citations.
			search_results: [{ url: "https://example.com/not-cited", title: "Not cited" }],
		};

		it("scrapes the live ChatGPT UI when no model is pinned, forcing web search", async () => {
			dataforseoClient.chatGptLlmScraperLiveAdvanced.mockResolvedValueOnce(scraperResponse(CHATGPT_SCRAPE));

			const result = await dataforseo.run("chatgpt", "What speaker released last month reviews well?", {
				webSearch: true,
			});

			expect(dataforseoClient.chatgptLlmResponsesLive).not.toHaveBeenCalled();
			const [payload] = dataforseoClient.chatGptLlmScraperLiveAdvanced.mock.calls[0];
			expect(payload[0]).toMatchObject({ location_code: 2840, force_web_search: true });

			expect(stored(result).textContent).toContain("JBL Xtreme 5");
			expect(result.webQueries).toEqual(["best speakers released July 2026"]);
			expect(stored(result).citations).toHaveLength(1);
			expect(stored(result).citations[0].domain).toBe("techradar.com");
			expect(result.modelVersion).toBe("gpt-5-5");
		});

		it("routes to LLM Responses instead when the target pins a model_name", async () => {
			dataforseoClient.chatgptLlmResponsesLive.mockResolvedValueOnce({
				tasks: [
					{
						status_code: 20000,
						status_message: "Ok.",
						result: [
							{ model_name: "gpt-4.1", items: [{ type: "message", sections: [{ type: "text", text: "Hi." }] }] },
						],
					},
				],
			});

			const result = await dataforseo.run("chatgpt", "What speaker reviews well?", {
				webSearch: true,
				version: "gpt-4.1",
			});

			expect(dataforseoClient.chatGptLlmScraperLiveAdvanced).not.toHaveBeenCalled();
			expect(dataforseoClient.chatgptLlmResponsesLive.mock.calls[0][0][0]).toMatchObject({ model_name: "gpt-4.1" });
			expect(result.modelVersion).toBe("gpt-4.1");
		});

		it("always uses LLM Responses for Perplexity, which has no scraper endpoint", async () => {
			dataforseoClient.perplexityLlmResponsesLive.mockResolvedValueOnce({
				tasks: [
					{
						status_code: 20000,
						status_message: "Ok.",
						result: [{ model_name: "sonar", items: [{ type: "message", sections: [{ type: "text", text: "Hi." }] }] }],
					},
				],
			});

			await dataforseo.run("perplexity", "What speaker reviews well?", { webSearch: true });

			expect(dataforseoClient.perplexityLlmResponsesLive).toHaveBeenCalledTimes(1);
		});

		it("rejects a version slug on a surface that is scraped rather than requested by model", () => {
			expect(
				dataforseo.validateTarget?.({
					model: "google-ai-mode",
					provider: "dataforseo",
					version: "gpt-4.1",
					webSearch: true,
				}),
			).toMatch(/does not accept a version slug/);
		});

		it("reads scraped citations from sources and dedupes them against the per-item copies", async () => {
			const url = "https://www.whathifi.com/reviews/sonos-era-300";
			dataforseoClient.geminiLlmScraperLiveAdvanced.mockResolvedValueOnce(
				scraperResponse({
					model: "3.5 Flash-Lite",
					markdown: "The Sonos Era 300 is a strong recent release.",
					sources: [{ url, title: "Sonos Era 300 review" }],
					items: [{ type: "gemini_text", sources: [{ url, title: "Sonos Era 300 review" }] }],
				}),
			);

			const result = await dataforseo.run("gemini", "What speaker reviews well?", { webSearch: true });

			expect(stored(result).citations).toHaveLength(1);
			expect(stored(result).citations[0].domain).toBe("whathifi.com");
			// Gemini's scraper reports no fan-out queries.
			expect(result.webQueries).toEqual(["unavailable"]);
		});

		it("re-extracts every shape the one provider id stores from rawOutput", async () => {
			dataforseoClient.chatGptLlmScraperLiveAdvanced.mockResolvedValueOnce(scraperResponse(CHATGPT_SCRAPE));
			const scraped = await dataforseo.run("chatgpt", "What speaker reviews well?", { webSearch: true });

			// Stored rows carry provider "dataforseo" whichever route produced them,
			// so the shared extractors have to tell the shapes apart.
			expect(extractTextContent(scraped.rawOutput, "dataforseo")).toContain("JBL Xtreme 5");
			expect(extractCitations(scraped.rawOutput, "dataforseo")).toHaveLength(1);

			dataforseoClient.googleOrganicLiveAdvanced.mockResolvedValueOnce(AI_OVERVIEW_OK);
			const serp = await dataforseo.run("google-ai-overview", "What speaker reviews well?", { webSearch: true });
			expect(extractTextContent(serp.rawOutput, "dataforseo")).toContain("Sonos Era 300");
			expect(extractCitations(serp.rawOutput, "dataforseo")).toHaveLength(1);
		});
	});

	it("does not send country localization for DataForSEO LLM Responses targets", async () => {
		dataforseoClient.chatgptLlmResponsesLive.mockResolvedValueOnce({
			tasks: [
				{
					status_code: 20000,
					status_message: "Ok.",
					result: [
						{
							model_name: "gpt-4o",
							fan_out_queries: ["current laptop reviews"],
							items: [
								{
									type: "message",
									sections: [
										{
											type: "text",
											text: "A current well-reviewed laptop is the Framework Laptop 13, based on recent reviews.",
											annotations: [{ url: "https://example.com/review", title: "Example review" }],
										},
									],
								},
							],
						},
					],
				},
			],
		});

		// country isn't a ProviderOptions field (intentionally not exposed); force it
		// through to prove DataForSEO never forwards it as web_search_country_iso_code.
		// The version pin is what selects the LLM Responses route.
		const options = { webSearch: true, version: "gpt-5.5", country: "GB" } as unknown as Parameters<
			typeof dataforseo.run
		>[2];
		await dataforseo.run("chatgpt", "What is a well-reviewed laptop this month?", options);

		const [payload] = dataforseoClient.chatgptLlmResponsesLive.mock.calls[0];
		expect(payload[0]).not.toHaveProperty("web_search_country_iso_code");
		expect(payload[0]).toMatchObject({
			user_prompt: "What is a well-reviewed laptop this month?",
			model_name: "gpt-5.5",
			web_search: true,
		});
	});

	it("fetches Google AI Overview from the organic SERP endpoint with async loading on", async () => {
		dataforseoClient.googleOrganicLiveAdvanced.mockResolvedValueOnce(AI_OVERVIEW_OK);

		const result = await dataforseo.run("google-ai-overview", "What is a well-reviewed speaker released last month?", {
			webSearch: true,
		});

		const [payload] = dataforseoClient.googleOrganicLiveAdvanced.mock.calls[0];
		expect(payload[0]).toMatchObject({
			keyword: "What is a well-reviewed speaker released last month?",
			location_code: 2840,
			load_async_ai_overview: true,
		});

		expect(stored(result).textContent).toContain("Sonos Era 300");
		expect(stored(result).citations).toHaveLength(1);
		expect(stored(result).citations[0].domain).toBe("whathifi.com");
		expect(result.webQueries).toEqual(["unavailable"]);
	});

	it("retries the AI Overview request when DataForSEO returns a transient server error", async () => {
		vi.useFakeTimers();
		dataforseoClient.googleOrganicLiveAdvanced
			.mockResolvedValueOnce({
				tasks: [{ status_code: 40602, status_message: "Internal SE Server Error.", result: null }],
			})
			.mockResolvedValueOnce(AI_OVERVIEW_OK);

		const promise = dataforseo.run("google-ai-overview", "What is a well-reviewed speaker released last month?", {
			webSearch: true,
		});
		await vi.runAllTimersAsync();
		const result = await promise;

		expect(dataforseoClient.googleOrganicLiveAdvanced).toHaveBeenCalledTimes(2);
		expect(stored(result).textContent).toContain("Sonos Era 300");
		expect(stored(result).citations).toHaveLength(1);
	});

	it("throws after exhausting retries when every AI Overview attempt fails", async () => {
		vi.useFakeTimers();
		dataforseoClient.googleOrganicLiveAdvanced.mockResolvedValue({
			tasks: [{ status_code: 40602, status_message: "Internal SE Server Error.", result: null }],
		});

		const promise = dataforseo.run("google-ai-overview", "What is a well-reviewed speaker released last month?", {
			webSearch: true,
		});
		const assertion = expect(promise).rejects.toThrow("DataForSEO API Error: 40602 Internal SE Server Error.");
		await vi.runAllTimersAsync();
		await assertion;

		expect(dataforseoClient.googleOrganicLiveAdvanced).toHaveBeenCalledTimes(3);
	});

	describe("located runs", () => {
		const fixture = (name: string) =>
			JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8")) as Record<string, unknown>;

		const RALEIGH_EAST: RunLocation = {
			pointId: "raleigh-e",
			latitude: 35.7796,
			longitude: -78.53101,
			city: "Raleigh",
			region: "NC",
			country: "US",
			timezone: "America/New_York",
		};
		const located = { webSearch: true, location: RALEIGH_EAST, locationTier: "T1" as const };

		it("places only the Google surfaces at the point", () => {
			const support = (model: string) =>
				dataforseo.locationSupport?.({ model, provider: "dataforseo", webSearch: true });

			expect(support("google-ai-mode")).toEqual([{ tier: "T1", reads: ["latitude", "longitude"] }]);
			expect(support("google-ai-overview")).toEqual([{ tier: "T1", reads: ["latitude", "longitude"] }]);
			for (const model of ["chatgpt", "gemini", "perplexity"]) expect(support(model)).toEqual([]);
		});

		it("asks AI Mode from the point and reports where Google placed it", async () => {
			dataforseoClient.googleAiModeLiveAdvanced.mockResolvedValueOnce(fixture("dataforseo-ai-mode-located.json"));

			const result = await dataforseo.run(
				"google-ai-mode",
				"I have a burst pipe, who's an emergency plumber near me?",
				located,
			);

			const [payload] = dataforseoClient.googleAiModeLiveAdvanced.mock.calls[0];
			expect(payload[0]).toMatchObject({ location_coordinate: "35.7796000,-78.5310100,15z" });
			expect(payload[0]).not.toHaveProperty("location_code");

			expect(stored(result).textContent).toContain("Bennie Bittle Plumbing");
			expect(result.vendorRunId).toBe("11090212-3073-0139-0000-18f44fb798a7");
			expect(result.costUsd).toBe(0.004);
			const reported = result.vendorReportedLocation as { latitude: number; longitude: number };
			expect(reported.latitude).toBeCloseTo(RALEIGH_EAST.latitude, 2);
			expect(reported.longitude).toBeCloseTo(RALEIGH_EAST.longitude, 2);
		});

		it("asks the organic SERP from the point and keeps its local pack for card parsing", async () => {
			dataforseoClient.googleOrganicLiveAdvanced.mockResolvedValueOnce(fixture("dataforseo-ai-overview-located.json"));

			const result = await dataforseo.run(
				"google-ai-overview",
				"plumbing company near me that does sewer line repair",
				located,
			);

			const [payload] = dataforseoClient.googleOrganicLiveAdvanced.mock.calls[0];
			expect(payload[0]).toMatchObject({
				location_coordinate: "35.7796000,-78.5310100,200",
				load_async_ai_overview: true,
			});
			expect(payload[0]).not.toHaveProperty("location_code");

			expect(stored(result).textContent).toContain("Matthew's Plumbing Solutions");
			expect(JSON.stringify(result.rawOutput)).toContain('"type":"local_pack"');
			expect(result.costUsd).toBe(0.004);
			expect(result.vendorReportedLocation).toMatchObject({ latitude: 35.7792277, longitude: -78.5308299 });
		});

		it("gives a located AI Overview more tries before giving up", async () => {
			vi.useFakeTimers();
			dataforseoClient.googleOrganicLiveAdvanced.mockResolvedValue({
				tasks: [{ status_code: 40101, status_message: "Internal SE Server Error.", result: null }],
			});

			const promise = dataforseo.run("google-ai-overview", "emergency plumber near me", located);
			const assertion = expect(promise).rejects.toThrow("DataForSEO API Error: 40101 Internal SE Server Error.");
			await vi.runAllTimersAsync();
			await assertion;

			expect(dataforseoClient.googleOrganicLiveAdvanced).toHaveBeenCalledTimes(5);
		});
	});

	it("resolves Gemini Vertex grounding-redirect citation URLs to the real source", async () => {
		const realUrl = "https://www.whathifi.com/best-buys/hi-fi/best-hi-fi-speakers";
		const redirectUrl = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/ABC123";

		dataforseoClient.geminiLlmResponsesLive.mockResolvedValueOnce({
			tasks: [
				{
					status_code: 20000,
					status_message: "Ok.",
					result: [
						{
							model_name: "gemini-2.5-flash",
							fan_out_queries: ["best speakers"],
							items: [
								{
									type: "message",
									sections: [
										{
											type: "text",
											text: "The What Hi-Fi roundup highlights several strong speakers released recently for review.",
											annotations: [{ url: redirectUrl, title: "whathifi.com" }],
										},
									],
								},
							],
						},
					],
				},
			],
		});

		// resolveGroundingRedirect uses global fetch with redirect:"manual" and reads
		// the Location header. The client call itself is mocked separately above.
		const fetchMock = vi.fn().mockResolvedValue({
			headers: { get: (k: string) => (k === "location" ? realUrl : null) },
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await dataforseo.run("gemini", "What are well-reviewed speakers?", {
			webSearch: true,
			version: "gemini-2.5-flash",
		});

		expect(fetchMock).toHaveBeenCalledWith(redirectUrl, expect.objectContaining({ redirect: "manual" }));
		expect(stored(result).citations).toHaveLength(1);
		expect(stored(result).citations[0].url).toBe(realUrl);
		expect(stored(result).citations[0].domain).toBe("whathifi.com");
		// The raw output is rewritten in place, so re-extraction stays consistent.
		const raw = result.rawOutput as {
			tasks: { result: { items: { sections: { annotations: { url: string }[] }[] }[] }[] }[];
		};
		const rawUrl = raw.tasks[0].result[0].items[0].sections[0].annotations[0].url;
		expect(rawUrl).toBe(realUrl);
	});
});
