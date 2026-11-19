import { brands, citations, competitors, organization, promptRuns, prompts } from "@workspace/lib/db/schema";
import { createOwnerDb } from "@workspace/lib/test/integration/owner-db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installLocalCitationCategories } from "../citation-categories";
import { areaCompetitors, localMentions, runLocations, samplePoints, subjectServiceAreas } from "../schema";
import { withSubject } from "../tenancy";
import { areaCitationGaps } from "./gaps";

const ORG = "citation-gaps-test-org";
const S = "citation-gaps-test-s";
const OTHER = "citation-gaps-test-other";
const RALEIGH = { lat: 35.7796, lng: -78.6382 };
const DURHAM = { lat: 35.994, lng: -78.8986 };
const NOW = new Date("2026-11-10T12:00:00Z");
const WINDOW = { since: new Date("2026-11-01T00:00:00Z"), until: new Date("2026-11-11T00:00:00Z") };

const owner = createOwnerDb();

let raleigh: { areaId: string; pointId: string };
let durham: { areaId: string; pointId: string };
let plumberPrompt: string;
let drainPrompt: string;

async function addArea(subjectId: string, name: string, at: { lat: number; lng: number }) {
	const [area] = await owner
		.insert(subjectServiceAreas)
		.values({
			subjectId,
			name,
			centerLat: at.lat,
			centerLng: at.lng,
			radiusMeters: 12000,
			isPrimary: name === "Raleigh",
			timezone: "America/New_York",
		})
		.returning();
	const [point] = await owner
		.insert(samplePoints)
		.values({
			subjectId,
			areaId: area.id,
			kind: "centroid",
			label: name,
			lat: at.lat,
			lng: at.lng,
			country: "US",
			timezone: "America/New_York",
		})
		.returning();
	return { areaId: area.id, pointId: point.id };
}

/** A run located in the area that counts the given businesses (null for the subject) and cites the URLs. */
async function answer(
	area: { pointId: string },
	opts: {
		model?: string;
		prompt?: string;
		at?: Date;
		counted?: (string | null)[];
		notCounted?: string[];
		cites: string[];
		subjectId?: string;
	},
) {
	const subjectId = opts.subjectId ?? S;
	const [run] = await owner
		.insert(promptRuns)
		.values({
			promptId: opts.prompt ?? plumberPrompt,
			brandId: subjectId,
			model: opts.model ?? "chatgpt",
			provider: "test",
			version: "test",
			webSearchEnabled: true,
			rawOutput: {},
			createdAt: opts.at ?? NOW,
		})
		.returning({ id: promptRuns.id });
	await owner.insert(runLocations).values({
		runId: run.id,
		subjectId,
		pointId: area.pointId,
		requestedLocation: { pointId: area.pointId, latitude: 0, longitude: 0, country: "US", timezone: "UTC" },
		locationMethod: "api_user_location",
		fidelityTier: "T4",
	});
	const mentions = [
		...(opts.counted ?? []).map((name) => ({ name, counted: true })),
		...(opts.notCounted ?? []).map((name) => ({ name, counted: false })),
	];
	for (const { name, counted } of mentions)
		await owner.insert(localMentions).values({
			runId: run.id,
			subjectId,
			competitorName: name,
			counted,
			method: "text+jev",
			confidence: counted ? 0.9 : 0.4,
		});
	for (const [i, url] of opts.cites.entries())
		await owner.insert(citations).values({
			promptRunId: run.id,
			promptId: opts.prompt ?? plumberPrompt,
			brandId: subjectId,
			model: opts.model ?? "chatgpt",
			url,
			domain: new URL(url).hostname,
			citationIndex: i,
			createdAt: opts.at ?? NOW,
		});
}

const track = (area: { areaId: string }, name: string, website: string | null = null, subjectId = S) =>
	owner.insert(areaCompetitors).values({
		subjectId,
		areaId: area.areaId,
		placeId: `ChIJ-${subjectId}-${name}`,
		name,
		website,
		tracked: true,
	});

const gapsIn = (area: { areaId: string }, scope: { model?: string; promptIds?: string[] } = {}) =>
	withSubject(S, () => areaCitationGaps(S, { areaId: area.areaId, ...WINDOW, ...scope }));

async function cleanUp() {
	for (const id of [S, OTHER]) {
		await owner.delete(citations).where(eq(citations.brandId, id));
		await owner.delete(promptRuns).where(eq(promptRuns.brandId, id));
	}
	for (const id of [S, OTHER]) {
		await owner.delete(prompts).where(eq(prompts.brandId, id));
		await owner.delete(competitors).where(eq(competitors.brandId, id));
		await owner.delete(brands).where(eq(brands.id, id));
	}
	await owner.delete(organization).where(eq(organization.id, ORG));
}

beforeAll(async () => {
	installLocalCitationCategories();
	await cleanUp();
	await owner.insert(organization).values({ id: ORG, name: "Gaps Test", slug: ORG, createdAt: new Date() });
	await owner.insert(brands).values([
		{ id: S, name: "Oak City Plumbing", website: "https://oakcity.example", organizationId: ORG },
		{ id: OTHER, name: "Other Plumbing", website: "https://other.example", organizationId: ORG },
	]);
	const [plumber, drain] = await owner
		.insert(prompts)
		.values([
			{ brandId: S, value: "best plumber near me" },
			{ brandId: S, value: "drain cleaning near me" },
		])
		.returning();
	plumberPrompt = plumber.id;
	drainPrompt = drain.id;
	await owner.insert(competitors).values({ brandId: S, name: "Capital Drains", domains: ["capitaldrains.example"] });
	raleigh = await addArea(S, "Raleigh", RALEIGH);
	durham = await addArea(S, "Durham", DURHAM);
	await track(raleigh, "Triangle Rooter", "https://www.triangle-rooter.example/");
	await track(raleigh, "Capital Drains");
	await track(durham, "Bull City Drains");

	await answer(raleigh, {
		model: "chatgpt",
		counted: ["Triangle Rooter", "Capital Drains"],
		cites: [
			"https://www.yelp.com/search?find_desc=plumbers&find_loc=Raleigh",
			"https://www.triangle-rooter.example/",
			"https://capitaldrains.example/about",
			"https://oakcity.example/",
		],
	});
	await answer(raleigh, {
		model: "google-ai-mode",
		counted: ["Triangle Rooter"],
		cites: ["https://www.yelp.com/biz/triangle-rooter-raleigh", "https://www.bbb.org/us/nc/raleigh/category/plumber"],
	});
	// The subject is named here, so Angi isn't a gap.
	await answer(raleigh, {
		counted: [null, "Capital Drains"],
		cites: ["https://www.angi.com/companylist/raleigh/plumbing.htm"],
	});
	await answer(raleigh, { counted: ["Triangle Rooter"], cites: ["https://www.angi.com/"] });
	// Ruled out as a namesake, so it doesn't count.
	await answer(raleigh, {
		notCounted: ["Triangle Rooter"],
		cites: ["https://www.homeadvisor.com/c.Plumbing.Raleigh.NC.html"],
	});
	// Named by Elmo's judge but not tracked in this area.
	await answer(raleigh, { counted: ["Bull City Drains"], cites: ["https://www.thumbtack.com/nc/raleigh/plumbers/"] });
	// Before the window.
	await answer(raleigh, {
		at: new Date("2026-10-01T12:00:00Z"),
		counted: ["Triangle Rooter"],
		cites: ["https://www.nextdoor.com/pages/triangle-rooter"],
	});
	await answer(raleigh, {
		prompt: drainPrompt,
		counted: ["Capital Drains"],
		cites: ["https://www.wral.com/story/best-drain-cleaners"],
	});
	await answer(durham, { counted: ["Bull City Drains"], cites: ["https://www.indyweek.com/best-of-durham"] });

	const other = await addArea(OTHER, "Raleigh", RALEIGH);
	await track(other, "Triangle Rooter", null, OTHER);
	await answer(other, {
		subjectId: OTHER,
		counted: ["Triangle Rooter"],
		cites: ["https://www.houzz.com/professionals/plumbing/raleigh"],
	});
});

afterAll(async () => {
	await cleanUp();
	await owner.$client.end();
});

describe("areaCitationGaps", () => {
	it("ranks the sources the area's answers cite for its competitors and never for the subject", async () => {
		const result = await gapsIn(raleigh);
		expect(result.trackedCompetitors).toBe(2);
		expect(
			result.gaps.map(({ domain, runs, engines, competitors, score }) => ({
				domain,
				runs,
				engines,
				competitors,
				score,
			})),
		).toEqual([
			{
				domain: "yelp.com",
				runs: 2,
				engines: ["chatgpt", "google-ai-mode"],
				competitors: [
					{ name: "Triangle Rooter", runs: 2 },
					{ name: "Capital Drains", runs: 1 },
				],
				score: 8,
			},
			{
				domain: "bbb.org",
				runs: 1,
				engines: ["google-ai-mode"],
				competitors: [{ name: "Triangle Rooter", runs: 1 }],
				score: 1,
			},
			{
				domain: "wral.com",
				runs: 1,
				engines: ["chatgpt"],
				competitors: [{ name: "Capital Drains", runs: 1 }],
				score: 1,
			},
		]);
		expect(result.gaps[0].category).toBe("listings");
	});

	it("keeps to the area, its prompts and its engines", async () => {
		expect((await gapsIn(durham)).gaps.map((gap) => gap.domain)).toEqual(["indyweek.com"]);
		expect((await gapsIn(raleigh, { promptIds: [drainPrompt] })).gaps.map((gap) => gap.domain)).toEqual(["wral.com"]);
		expect((await gapsIn(raleigh, { model: "google-ai-mode" })).gaps.map((gap) => gap.domain)).toEqual([
			"bbb.org",
			"yelp.com",
		]);
	});

	it("finds nothing to compare against in an area that tracks no competitors", async () => {
		const empty = await addArea(S, "Cary", { lat: 35.7915, lng: -78.7811 });
		await answer(empty, { counted: ["Triangle Rooter"], cites: ["https://www.yelp.com/"] });
		expect(await gapsIn(empty)).toEqual({ trackedCompetitors: 0, runs: 0, gaps: [] });
	});
});
