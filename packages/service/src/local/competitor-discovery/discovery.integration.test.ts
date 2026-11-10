import { brands, competitors, organization, promptRuns, prompts, usageEvents } from "@workspace/lib/db/schema";
import { createOwnerDb } from "@workspace/lib/test/integration/owner-db";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PlaceCandidate, PlacesProvider } from "../../providers/places";
import { nameKey } from "../named-businesses/names";
import { PLACES_CALLS_PER_DAY } from "../places/usage";
import {
	answerBusinesses,
	answerNamedBusinesses,
	areaCompetitors,
	competitorSeedSearches,
	placeAnchors,
	placeResolutions,
	runLocations,
	samplePoints,
	subjectServiceAreas,
} from "../schema";
import { withSubject } from "../tenancy";
import { DISCOVERY_ACTOR, discoverCompetitors } from "./discover";
import { addService, saveDiscoverySettings, setCompetitorStatus } from "./manage";
import { seedCompetitors } from "./seed";

const ORG = "competitor-discovery-test-org";
const S = "competitor-discovery-test-s";
const SUBJECT_PLACE = "ChIJoakcityoakcity0001";
const RALEIGH = { lat: 35.7796, lng: -78.6382 };
const DURHAM = { lat: 35.994, lng: -78.8986 };

const owner = createOwnerDb();

const place = (name: string, placeId: string, at: { lat: number; lng: number }, website: string | null = null) =>
	({
		placeId,
		cid: null,
		name,
		phone: null,
		address: null,
		lat: at.lat,
		lng: at.lng,
		primaryType: "plumber",
		types: ["plumber"],
		mapsUrl: null,
		website,
	}) satisfies PlaceCandidate;

function placesWith(candidates: Record<string, PlaceCandidate[]>) {
	const searched: string[] = [];
	const provider: PlacesProvider = {
		async searchText(query, area) {
			searched.push(`${query} @ ${area?.lat}`);
			return { data: candidates[query] ?? [], sku: "text_search_enterprise" };
		},
		checkPlaceId: () => Promise.reject(new Error("not used")),
		mapsCid: () => Promise.reject(new Error("not used")),
		geocode: () => Promise.reject(new Error("not used")),
	};
	return { provider, searched };
}

let raleigh: { areaId: string; pointId: string };
let durham: { areaId: string; pointId: string };
let plumberPrompt: string;

async function addArea(name: string, at: { lat: number; lng: number }, isPrimary: boolean) {
	const [area] = await owner
		.insert(subjectServiceAreas)
		.values({
			subjectId: S,
			name,
			centerLat: at.lat,
			centerLng: at.lng,
			radiusMeters: 12000,
			isPrimary,
			timezone: "America/New_York",
		})
		.returning();
	const [point] = await owner
		.insert(samplePoints)
		.values({
			subjectId: S,
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

/** A run located in the area whose answer names each business, resolved to the given Place ID. */
async function runNaming(area: { pointId: string }, named: { name: string; placeId: string }[]) {
	const [run] = await owner
		.insert(promptRuns)
		.values({
			promptId: plumberPrompt,
			brandId: S,
			model: "claude",
			provider: "anthropic-api",
			version: "test",
			webSearchEnabled: true,
			rawOutput: {},
		})
		.returning({ id: promptRuns.id });
	await owner.insert(runLocations).values({
		runId: run.id,
		subjectId: S,
		pointId: area.pointId,
		requestedLocation: { pointId: area.pointId, latitude: 0, longitude: 0, country: "US", timezone: "UTC" },
		locationMethod: "api_user_location",
		fidelityTier: "T4",
		businessesVersion: 1,
	});
	for (const [i, { name, placeId }] of named.entries()) {
		await owner
			.insert(answerNamedBusinesses)
			.values({ runId: run.id, subjectId: S, position: i + 1, name, nameKey: nameKey(name) });
		await owner
			.insert(placeResolutions)
			.values({
				subjectId: S,
				nameKey: nameKey(name),
				resolution: "matched",
				placeId,
				searchQuery: name,
			})
			.onConflictDoNothing();
	}
	return run.id;
}

const seed = (provider: PlacesProvider) => withSubject(S, () => seedCompetitors(provider, S, 20));
const discover = () => withSubject(S, () => discoverCompetitors(S));
const rowsIn = (area: { areaId: string }) =>
	owner
		.select()
		.from(areaCompetitors)
		.where(eq(areaCompetitors.areaId, area.areaId))
		.orderBy(asc(areaCompetitors.name));
const tracked = async (area: { areaId: string }) =>
	(await rowsIn(area)).filter((row) => row.tracked).map((row) => row.name);
const elmoCompetitors = () =>
	owner.select().from(competitors).where(eq(competitors.brandId, S)).orderBy(asc(competitors.name));

beforeAll(async () => {
	await cleanUp();
	await owner.insert(organization).values({ id: ORG, name: "Discovery Test", slug: ORG, createdAt: new Date() });
	await owner
		.insert(brands)
		.values({ id: S, name: "Oak City Plumbing", website: "https://oakcity.example", organizationId: ORG });
	const [prompt] = await owner
		.insert(prompts)
		.values({ brandId: S, value: "best plumber near me", tags: ["service:plumber"] })
		.returning();
	plumberPrompt = prompt.id;
	raleigh = await addArea("Raleigh", RALEIGH, true);
	durham = await addArea("Durham", DURHAM, false);
	await owner
		.insert(placeAnchors)
		.values({ subjectId: S, placeId: SUBJECT_PLACE, searchQuery: "Oak City Plumbing", confirmedBy: "staff" });
	await withSubject(S, () => addService(S, "plumber"));
});

afterAll(async () => {
	await cleanUp();
	await owner.$client.end();
});

async function cleanUp() {
	await owner.delete(usageEvents).where(eq(usageEvents.brandId, S));
	await owner.delete(promptRuns).where(eq(promptRuns.brandId, S));
	await owner.delete(prompts).where(eq(prompts.brandId, S));
	await owner.delete(competitors).where(eq(competitors.brandId, S));
	await owner.delete(brands).where(eq(brands.id, S));
	await owner.delete(organization).where(eq(organization.id, ORG));
}

describe("competitor discovery", () => {
	const { provider, searched } = placesWith({
		plumber: [
			place("Oak City Plumbing", SUBJECT_PLACE, RALEIGH),
			place("Triangle Rooter", "ChIJtrianglerooter0001", RALEIGH, "https://www.triangle-rooter.example/"),
			place("Capital Drains", "ChIJcapitaldrains00001", RALEIGH, "https://www.facebook.com/capitaldrains"),
			place("Mile High Plumbing", "ChIJmilehighplumbing01", { lat: 39.7392, lng: -104.9903 }),
		],
	});

	it("seeds each service in each area once, before any scan, leaving out the subject and listings elsewhere", async () => {
		expect(await seed(provider)).toEqual({ searched: 2, found: 2 });
		expect(searched).toEqual([`plumber @ ${RALEIGH.lat}`, `plumber @ ${DURHAM.lat}`]);
		expect((await rowsIn(raleigh)).map(({ name, seedRank }) => [name, seedRank])).toEqual([
			["Capital Drains", 2],
			["Triangle Rooter", 1],
		]);
		expect(await rowsIn(durham)).toEqual([]);
		expect(
			await owner.select().from(competitorSeedSearches).where(eq(competitorSeedSearches.subjectId, S)),
		).toHaveLength(2);

		expect(await seed(provider)).toEqual({ searched: 0, found: 0 });
		expect(searched).toHaveLength(2);
	});

	it("tracks the seeded businesses as competitors, anchored on their listings, with a domain only when it's theirs", async () => {
		expect(await discover()).toMatchObject({ added: ["Triangle Rooter", "Capital Drains"], removed: [] });
		expect(await tracked(raleigh)).toEqual(["Capital Drains", "Triangle Rooter"]);
		expect((await elmoCompetitors()).map(({ name, domains }) => [name, domains])).toEqual([
			["Capital Drains", []],
			["Triangle Rooter", ["triangle-rooter.example"]],
		]);
		const anchors = await owner
			.select()
			.from(placeAnchors)
			.where(and(eq(placeAnchors.subjectId, S), eq(placeAnchors.confirmedBy, DISCOVERY_ACTOR)));
		expect(anchors.map(({ competitorName, placeId }) => [competitorName, placeId]).sort()).toEqual([
			["Capital Drains", "ChIJcapitaldrains00001"],
			["Triangle Rooter", "ChIJtrianglerooter0001"],
		]);
	});

	it("tracks a business the area's answers keep naming, there and not in another area", async () => {
		const bullCity = { name: "Bull City Drain", placeId: "ChIJbullcitydrain0001" };
		await runNaming(durham, [bullCity]);
		await runNaming(durham, [bullCity, { name: "Oak City Plumbing", placeId: SUBJECT_PLACE }]);
		await discover();
		expect(await tracked(durham)).toEqual([]);

		await runNaming(durham, [{ name: "Bull City Drain Cleaning", placeId: bullCity.placeId }]);
		await runNaming(raleigh, [bullCity]);
		const result = await discover();
		expect(result.added).toEqual(["Bull City Drain"]);
		expect(await tracked(durham)).toEqual(["Bull City Drain"]);
		expect((await rowsIn(durham))[0]).toMatchObject({
			answerRuns: 3,
			aliases: ["Bull City Drain Cleaning"],
			services: ["plumber"],
		});
		expect(await tracked(raleigh)).toEqual(["Capital Drains", "Triangle Rooter"]);
		expect((await rowsIn(raleigh)).find((row) => row.name === "Bull City Drain")).toMatchObject({
			answerRuns: 1,
			tracked: false,
		});
		expect((await elmoCompetitors()).find((c) => c.name === "Bull City Drain")?.aliases).toEqual([
			"Bull City Drain Cleaning",
		]);
	});

	it("counts a card in the answer near the area, but not one placed elsewhere", async () => {
		const runId = await runNaming(raleigh, []);
		await owner.insert(answerBusinesses).values([
			{
				runId,
				subjectId: S,
				placement: "answer",
				position: 1,
				name: "Triangle Rooter",
				placeId: "ChIJtrianglerooter0001",
				...RALEIGH,
			},
			{
				runId,
				subjectId: S,
				placement: "answer",
				position: 2,
				name: "Mile High Plumbing",
				placeId: "ChIJmilehighplumbing01",
				lat: 39.7392,
				lng: -104.9903,
			},
			{
				runId,
				subjectId: S,
				placement: "local_pack",
				position: 1,
				name: "Pack Plumbing",
				placeId: "ChIJpackplumbing00001",
				...RALEIGH,
			},
		]);
		await discover();
		const rows = await rowsIn(raleigh);
		expect(rows.find((row) => row.name === "Triangle Rooter")?.answerRuns).toBe(1);
		expect(rows.map((row) => row.name)).not.toContain("Mile High Plumbing");
		expect(rows.map((row) => row.name)).not.toContain("Pack Plumbing");
	});

	describe("with one automatic competitor per area", () => {
		beforeEach(async () => {
			await withSubject(S, () => saveDiscoverySettings(S, { minRuns: 3, perArea: 1, windowDays: 90 }));
		});

		it("stops tracking the one that falls out, and removes the competitor discovery added for it", async () => {
			const result = await discover();
			expect(result.removed).toEqual(["Capital Drains"]);
			expect(await tracked(raleigh)).toEqual(["Triangle Rooter"]);
			expect((await elmoCompetitors()).map(({ name }) => name)).toEqual(["Bull City Drain", "Triangle Rooter"]);
			const anchor = await owner
				.select()
				.from(placeAnchors)
				.where(and(eq(placeAnchors.subjectId, S), eq(placeAnchors.competitorName, "Capital Drains")));
			expect(anchor).toEqual([]);
		});

		it("keeps a pinned business tracked beyond the limit, and never tracks an ignored one", async () => {
			const rows = await rowsIn(raleigh);
			const id = (name: string) => rows.find((row) => row.name === name)?.id as string;
			await withSubject(S, () => setCompetitorStatus(S, { id: id("Capital Drains"), status: "pinned", by: "staff" }));
			await withSubject(S, () => setCompetitorStatus(S, { id: id("Triangle Rooter"), status: "ignored", by: "staff" }));
			const result = await discover();
			expect(result.added).toEqual(["Capital Drains"]);
			expect(await tracked(raleigh)).toEqual(["Capital Drains"]);
			expect((await elmoCompetitors()).map(({ name }) => name)).toEqual(["Bull City Drain", "Capital Drains"]);
		});

		it("never changes or removes a competitor staff added, even under a discovered name", async () => {
			await owner.insert(competitors).values({ brandId: S, name: "Acme Plumbing", domains: ["acme.example"] });
			const acme = { name: "Acme Plumbing", placeId: "ChIJacmeplumbing00001" };
			for (let i = 0; i < 3; i++) await runNaming(durham, [acme]);
			await discover();
			const durhamRows = await rowsIn(durham);
			const acmeRow = durhamRows.find((row) => row.name === "Acme Plumbing");
			expect(acmeRow).toMatchObject({ ownsCompetitor: false });
			await withSubject(S, () => setCompetitorStatus(S, { id: acmeRow?.id as string, status: "ignored", by: "staff" }));
			await discover();
			expect((await elmoCompetitors()).find((c) => c.name === "Acme Plumbing")?.domains).toEqual(["acme.example"]);
		});
	});

	it("seeds nothing once the subject has used its Places calls for the day", async () => {
		const [org] = await owner.select({ id: brands.organizationId }).from(brands).where(eq(brands.id, S));
		await withSubject(S, () => addService(S, "water heater repair"));
		await owner.insert(usageEvents).values(
			Array.from({ length: PLACES_CALLS_PER_DAY }, () => ({
				organizationId: org.id,
				brandId: S,
				eventType: "places_call",
				provider: "google-places",
				model: "text_search_enterprise",
			})),
		);
		const { provider: fresh, searched: none } = placesWith({});
		expect(await seed(fresh)).toEqual({ searched: 0, found: 0 });
		expect(none).toEqual([]);
	});
});
