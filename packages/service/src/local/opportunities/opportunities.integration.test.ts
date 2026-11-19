import {
	brandOpportunities,
	brands,
	citations,
	organization,
	promptRuns,
	prompts,
	usageEvents,
} from "@workspace/lib/db/schema";
import { createOwnerDb } from "@workspace/lib/test/integration/owner-db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { installLocalCitationCategories } from "../citation-categories";
import { areaCompetitors, localMentions, runLocations, samplePoints, subjectServiceAreas } from "../schema";
import type { RawLocalReport } from "./playbook";
import { type GeneratePlaybook, PLAYBOOK_USAGE_EVENT, resolveLocalOpportunities } from "./resolve";

const ORG = "local-opportunities-test-org";
const S = "local-opportunities-test-s";
const QUIET = "local-opportunities-test-quiet";
const BRAND_ONLY = "local-opportunities-test-brand";
const NOW = new Date("2026-11-10T12:00:00Z");
const PROMPT = "Who is the best plumber near me?";

const owner = createOwnerDb();

async function addArea(subjectId: string) {
	const [area] = await owner
		.insert(subjectServiceAreas)
		.values({
			subjectId,
			name: "Raleigh",
			centerLat: 35.7796,
			centerLng: -78.6382,
			radiusMeters: 12000,
			isPrimary: true,
			timezone: "America/New_York",
		})
		.returning();
	const [point] = await owner
		.insert(samplePoints)
		.values({
			subjectId,
			areaId: area.id,
			kind: "centroid",
			label: "Raleigh",
			lat: 35.7796,
			lng: -78.6382,
			country: "US",
			timezone: "America/New_York",
		})
		.returning();
	return { areaId: area.id, pointId: point.id };
}

async function answer(promptId: string, pointId: string, counted: (string | null)[], cites: string[]) {
	const [run] = await owner
		.insert(promptRuns)
		.values({
			promptId,
			brandId: S,
			model: "chatgpt",
			provider: "test",
			version: "test",
			webSearchEnabled: true,
			rawOutput: {},
			createdAt: NOW,
		})
		.returning({ id: promptRuns.id });
	await owner.insert(runLocations).values({
		runId: run.id,
		subjectId: S,
		pointId,
		requestedLocation: { pointId, latitude: 0, longitude: 0, country: "US", timezone: "UTC" },
		locationMethod: "api_user_location",
		fidelityTier: "T4",
		localMentionsStamp: "test",
	});
	for (const name of counted)
		await owner.insert(localMentions).values({
			runId: run.id,
			subjectId: S,
			competitorName: name,
			counted: true,
			method: "text+jev",
			confidence: 0.9,
		});
	for (const [i, url] of cites.entries())
		await owner.insert(citations).values({
			promptRunId: run.id,
			promptId,
			brandId: S,
			model: "chatgpt",
			url,
			domain: new URL(url).hostname,
			title: `Page ${i}`,
			citationIndex: i,
			createdAt: NOW,
		});
}

const opportunity = (overrides: Partial<RawLocalReport["opportunities"][number]> = {}) => ({
	category: "listings" as const,
	title: "Claim and complete the Yelp profile",
	why: "Yelp is cited whenever Acme is named in Raleigh.",
	onPage: false,
	sources: ["yelp.com"],
	relatedPrompts: [PROMPT],
	...overrides,
});

const generating = (raw: RawLocalReport) =>
	vi.fn<GeneratePlaybook>(async () => ({ object: raw, modelVersion: "test-model" }));

async function cleanUp() {
	for (const id of [S, QUIET, BRAND_ONLY]) {
		await owner.delete(usageEvents).where(eq(usageEvents.brandId, id));
		await owner.delete(brandOpportunities).where(eq(brandOpportunities.brandId, id));
		await owner.delete(citations).where(eq(citations.brandId, id));
		await owner.delete(promptRuns).where(eq(promptRuns.brandId, id));
		await owner.delete(prompts).where(eq(prompts.brandId, id));
		await owner.delete(brands).where(eq(brands.id, id));
	}
	await owner.delete(organization).where(eq(organization.id, ORG));
}

beforeAll(async () => {
	installLocalCitationCategories();
	await cleanUp();
	await owner.insert(organization).values({ id: ORG, name: "Opportunities Test", slug: ORG, createdAt: new Date() });
	await owner.insert(brands).values([
		{ id: S, name: "Oak City Plumbing", website: "https://oakcity.example", organizationId: ORG },
		{ id: QUIET, name: "Quiet Plumbing", website: "https://quiet.example", organizationId: ORG },
		{ id: BRAND_ONLY, name: "Brand Only", website: "https://brand.example", organizationId: ORG },
	]);
	const [best, hours] = await owner
		.insert(prompts)
		.values([
			{ brandId: S, value: PROMPT, tags: ["near-me"] },
			{ brandId: S, value: "What are the hours for Oak City Plumbing?", tags: [] },
		])
		.returning({ id: prompts.id });
	const raleigh = await addArea(S);
	await addArea(QUIET);
	await owner.insert(areaCompetitors).values({
		subjectId: S,
		areaId: raleigh.areaId,
		placeId: "ChIJ-acme",
		name: "Acme Plumbing",
		website: "https://acmeplumbing.example",
		tracked: true,
	});
	await answer(
		best.id,
		raleigh.pointId,
		["Acme Plumbing"],
		["https://www.yelp.com/biz/acme-plumbing-raleigh", "https://acmeplumbing.example/"],
	);
	await answer(best.id, raleigh.pointId, ["Acme Plumbing"], ["https://www.yelp.com/biz/acme-plumbing-raleigh"]);
	await answer(hours.id, raleigh.pointId, [null], ["https://oakcity.example/hours"]);
});

afterAll(async () => {
	await cleanUp();
	await owner.$client.end();
});

const usage = () =>
	owner
		.select({ units: usageEvents.units, model: usageEvents.model })
		.from(usageEvents)
		.where(and(eq(usageEvents.brandId, S), eq(usageEvents.eventType, PLAYBOOK_USAGE_EVENT)));

describe("resolveLocalOpportunities", () => {
	it("leaves a subject with no service area to Elmo's report", async () => {
		const generate = generating({ summary: [], opportunities: [], risks: [] });

		expect(await resolveLocalOpportunities(BRAND_ONLY, { generate, now: NOW })).toBeNull();
		expect(generate).not.toHaveBeenCalled();
	});

	it("says there's not enough data when the subject has no matched answers, whatever Elmo stored", async () => {
		await owner.insert(brandOpportunities).values({
			brandId: QUIET,
			report: { summary: [], opportunities: [], risks: [] },
			createdAt: NOW,
		});
		const generate = generating({ summary: [], opportunities: [], risks: [] });

		expect(await resolveLocalOpportunities(QUIET, { generate, now: NOW })).toMatchObject({
			report: null,
			reason: "insufficient-data",
		});
		expect(generate).not.toHaveBeenCalled();
	});

	it("generates from the subject's located answers, keeps only grounded opportunities, stores it and records usage", async () => {
		const generate = generating({
			summary: ["Acme is named in every Raleigh answer that cites Yelp."],
			opportunities: [
				opportunity(),
				opportunity({ title: "Get into the Raleigh Magazine list", sources: ["raleighmag.com"] }),
			],
			risks: ["Only three answers so far."],
		});

		const result = await resolveLocalOpportunities(S, { generate, now: NOW });

		const [prompt] = generate.mock.calls[0] ?? [];
		expect(prompt).toContain("AREA: Raleigh (primary) — 3 answers; tracked competitors: Acme Plumbing");
		expect(prompt).toContain("yelp.com [listings]");
		expect(result?.report?.opportunities).toEqual([
			expect.objectContaining({
				category: "listings",
				title: "Claim and complete the Yelp profile",
				relatedPrompts: [{ text: PROMPT, promptId: expect.any(String) }],
				sources: [
					{
						domain: "yelp.com",
						category: "listings",
						pages: [{ title: "Page 0", domain: "yelp.com", url: "https://www.yelp.com/biz/acme-plumbing-raleigh" }],
					},
				],
				yourCitations: [],
				competitorCitations: [
					{ title: "Page 1", domain: "acmeplumbing.example", url: "https://acmeplumbing.example/" },
				],
			}),
		]);
		expect(result?.model).toBe("test-model");

		const stored = await owner.select().from(brandOpportunities).where(eq(brandOpportunities.brandId, S));
		expect(stored).toHaveLength(1);
		expect(stored[0]?.report).toEqual(result?.report);
		expect(await usage()).toEqual([{ units: 1, model: "test-model" }]);
	});

	it("serves the stored playbook until it's stale", async () => {
		const generate = generating({ summary: [], opportunities: [], risks: [] });
		const later = new Date(NOW.getTime() + 2 * 86_400_000);

		const result = await resolveLocalOpportunities(S, { generate, now: later });

		expect(generate).not.toHaveBeenCalled();
		expect(result?.report?.opportunities.map(({ title }) => title)).toEqual(["Claim and complete the Yelp profile"]);
	});

	it("falls back to the stored playbook when a stale one can't be regenerated, counting every attempt", async () => {
		const generate = vi.fn<GeneratePlaybook>(async () => {
			throw new Error("provider down");
		});
		const later = new Date(NOW.getTime() + 7 * 86_400_000);

		const result = await resolveLocalOpportunities(S, { generate, now: later });

		expect(generate).toHaveBeenCalledTimes(3);
		expect(result?.report?.opportunities).toHaveLength(1);
		expect((await usage()).map(({ units }) => units).sort()).toEqual([1, 3]);
	});

	it("gives on-page advice only on facts from the facts API", async () => {
		const generate = generating({
			summary: [],
			opportunities: [
				opportunity({ category: "service-pages", title: "Add your hours to the hours page", onPage: true }),
			],
			risks: [],
		});
		await owner.delete(brandOpportunities).where(eq(brandOpportunities.brandId, S));

		const result = await resolveLocalOpportunities(S, {
			generate,
			now: NOW,
			loadFacts: async () => ({ source: "facts-api", facts: [{ label: "Hours", value: "Mon-Fri 7am-6pm" }] }),
		});

		const [prompt] = generate.mock.calls[0] ?? [];
		expect(prompt).toContain("- Hours: Mon-Fri 7am-6pm");
		expect(result?.report?.opportunities.map(({ title }) => title)).toEqual(["Add your hours to the hours page"]);
	});
});
