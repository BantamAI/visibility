import { db } from "@workspace/lib/db/db";
import { brands, competitors, organization, usageEvents } from "@workspace/lib/db/schema";
import { createOwnerDb } from "@workspace/lib/test/integration/owner-db";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlaceCandidate, PlaceIdCheck, PlacesProvider, SearchArea } from "../../providers/places";
import { placeAnchors } from "../schema";
import { saveServiceArea } from "../service-areas";
import { withSubject } from "../tenancy";
import {
	confirmAnchor,
	findPlaces,
	geocodeAddress,
	listAnchorTargets,
	PlaceAnchorError,
	removeAnchor,
} from "./anchors";
import { dueAnchors, refreshAnchors } from "./refresh";

const ORG = "places-test-org";
const A = "places-test-a";
const B = "places-test-b";
const owner = createOwnerDb();

const ACME_ID = "ChIJacmeacmeacmeacme0001";
const ACME_ELSEWHERE_ID = "ChIJacmeacmeacmeacme0002";
const RIVAL_ID = "ChIJrivalrivalrivalriv0001";

function candidate(placeId: string, name: string, lat: number, lng: number): PlaceCandidate {
	return {
		placeId,
		cid: "123456789",
		name,
		phone: "+19195550100",
		address: null,
		lat,
		lng,
		primaryType: "plumber",
		types: ["plumber"],
		mapsUrl: null,
		website: null,
	};
}

function fakeProvider(checks: Record<string, PlaceIdCheck> = {}) {
	const searches: { query: string; area: SearchArea | null }[] = [];
	const provider: PlacesProvider = {
		async searchText(query, area) {
			searches.push({ query, area });
			return {
				data: [
					candidate(ACME_ID, "Acme Plumbing", 35.78, -78.64),
					candidate(ACME_ELSEWHERE_ID, "Acme Plumbing", 39.96, -83.0),
				],
				sku: "text_search_enterprise",
			};
		},
		async checkPlaceId(placeId) {
			return { data: checks[placeId] ?? { status: "current", placeId }, sku: "place_details_ids_only" };
		},
		async mapsCid() {
			return { data: "987654321", sku: "place_details_pro" };
		},
		async geocode(address) {
			return { data: { lat: 35.78, lng: -78.64, formattedAddress: address, placeId: null }, sku: "geocoding" };
		},
	};
	return { provider, searches };
}

beforeAll(async () => {
	await cleanUp();
	await owner.insert(organization).values({ id: ORG, name: "Places Test", slug: ORG, createdAt: new Date() });
	await owner.insert(brands).values([
		{ id: A, name: "Acme Plumbing", website: "https://a.example", organizationId: ORG },
		{ id: B, name: "Beta Plumbing", website: "https://b.example", organizationId: ORG },
	]);
	await owner.insert(competitors).values({ brandId: A, name: "Rival Rooter", domains: ["rival.example"] });
	await withSubject(A, () =>
		saveServiceArea(A, {
			name: "Raleigh",
			centerLat: 35.7796,
			centerLng: -78.6382,
			radiusMeters: 16_000,
			timezone: "America/New_York",
		}),
	);
});

afterAll(async () => {
	await cleanUp();
	await owner.$client.end();
});

async function cleanUp() {
	await owner.delete(usageEvents).where(eq(usageEvents.organizationId, ORG));
	await owner.delete(competitors).where(inArray(competitors.brandId, [A, B]));
	await owner.delete(brands).where(inArray(brands.id, [A, B]));
	await owner.delete(organization).where(eq(organization.id, ORG));
}

async function placesSpend(subjectId: string) {
	return owner
		.select({ model: usageEvents.model, cost: usageEvents.estimatedCostUsd })
		.from(usageEvents)
		.where(and(eq(usageEvents.brandId, subjectId), eq(usageEvents.provider, "google-places")));
}

describe("finding and confirming anchors", () => {
	it("searches near the subject's service area, says which candidates are in it, and records the call's cost", async () => {
		const { provider, searches } = fakeProvider();
		const result = await withSubject(A, () => findPlaces(provider, A, { query: "Acme Plumbing" }));

		expect(searches).toEqual([{ query: "Acme Plumbing", area: { lat: 35.7796, lng: -78.6382, radiusMeters: 16_000 } }]);
		expect(result.area?.name).toBe("Raleigh");
		expect(result.candidates.map((c) => [c.placeId, c.insideArea])).toEqual([
			[ACME_ID, true],
			[ACME_ELSEWHERE_ID, false],
		]);
		expect(result.candidates[1].distanceMeters).toBeGreaterThan(500_000);
		expect(await placesSpend(A)).toEqual([{ model: "text_search_enterprise", cost: "0.035000" }]);
	});

	it("anchors the subject and a tracked competitor, keeping one anchor each", async () => {
		await withSubject(A, async () => {
			const input = { cid: "123456789", searchQuery: "Acme Plumbing", confirmedBy: "staff@example.com" };
			await confirmAnchor(A, { ...input, competitorName: null, placeId: ACME_ELSEWHERE_ID });
			await confirmAnchor(A, { ...input, competitorName: null, placeId: ACME_ID });
			await confirmAnchor(A, { ...input, competitorName: "rival rooter", placeId: RIVAL_ID });
		});

		const targets = await withSubject(A, () => listAnchorTargets(A));
		expect(targets.map((t) => [t.competitorName, t.name, t.anchor?.placeId])).toEqual([
			[null, "Acme Plumbing", ACME_ID],
			["Rival Rooter", "Rival Rooter", RIVAL_ID],
		]);
		expect(targets[1].anchor?.competitorName).toBe("Rival Rooter");
	});

	it("keeps a competitor's anchor when Elmo replaces its competitor rows on save", async () => {
		await owner.delete(competitors).where(eq(competitors.brandId, A));
		await owner.insert(competitors).values({ brandId: A, name: "Rival Rooter", domains: ["rival.example"] });

		const targets = await withSubject(A, () => listAnchorTargets(A));
		expect(targets[1].anchor?.placeId).toBe(RIVAL_ID);
	});

	it("refuses to anchor a business that isn't the subject or a tracked competitor", async () => {
		const confirm = withSubject(A, () =>
			confirmAnchor(A, {
				competitorName: "Unknown Drains",
				placeId: RIVAL_ID,
				cid: null,
				searchQuery: "Unknown Drains",
				confirmedBy: "staff@example.com",
			}),
		);
		await expect(confirm).rejects.toBeInstanceOf(PlaceAnchorError);
	});

	it("doesn't show one subject's anchors to another", async () => {
		const rows = await withSubject(B, () => db.select().from(placeAnchors));
		expect(rows).toEqual([]);
		const targets = await withSubject(B, () => listAnchorTargets(B));
		expect(targets).toEqual([{ competitorName: null, name: "Beta Plumbing", anchor: null }]);
	});
});

describe("refreshing Place IDs", () => {
	const longAgo = new Date("2020-01-01T00:00:00Z");

	it("checks only anchors older than 12 months", async () => {
		await owner.update(placeAnchors).set({ checkedAt: longAgo }).where(eq(placeAnchors.placeId, ACME_ID));
		const due = await dueAnchors(100);
		expect(due.get(A)?.map((a) => a.placeId)).toEqual([ACME_ID]);
	});

	it("marks a retired ID obsolete, stores a replaced one, and records each check", async () => {
		await owner.update(placeAnchors).set({ checkedAt: longAgo }).where(eq(placeAnchors.subjectId, A));
		const newRivalId = "ChIJrivalrivalrivalriv0002";
		const { provider } = fakeProvider({
			[ACME_ID]: { status: "not_found" },
			[RIVAL_ID]: { status: "current", placeId: newRivalId },
		});
		const now = new Date();

		const anchors = (await dueAnchors(100, now)).get(A) ?? [];
		const result = await withSubject(A, () => refreshAnchors(provider, A, anchors, now));

		expect(result).toEqual({ current: 0, changed: 1, obsolete: 1 });
		const rows = await owner.select().from(placeAnchors).where(eq(placeAnchors.subjectId, A));
		const acme = rows.find((r) => r.competitorName === null);
		const rival = rows.find((r) => r.competitorName !== null);
		expect(acme).toMatchObject({ placeId: ACME_ID, obsoleteAt: now });
		expect(rival).toMatchObject({ placeId: newRivalId, cid: "987654321", checkedAt: now, obsoleteAt: null });
		expect((await placesSpend(A)).map((e) => e.model).sort()).toEqual([
			"place_details_ids_only",
			"place_details_ids_only",
			"place_details_pro",
			"text_search_enterprise",
		]);
		expect((await dueAnchors(100, now)).has(A)).toBe(false);
	});

	it("clears the obsolete mark when staff confirm the business again", async () => {
		await withSubject(A, () =>
			confirmAnchor(A, {
				competitorName: null,
				placeId: ACME_ID,
				cid: null,
				searchQuery: "Acme Plumbing",
				confirmedBy: "staff@example.com",
			}),
		);
		const [acme] = await withSubject(A, () => listAnchorTargets(A));
		expect(acme.anchor?.obsoleteAt).toBeNull();
		expect(await withSubject(A, () => removeAnchor(A, null))).toBe(true);
	});
});

it("geocodes an address and records the call", async () => {
	const { provider } = fakeProvider();
	const result = await withSubject(B, () => geocodeAddress(provider, B, "1 Main St, Raleigh, NC"));
	expect(result).toMatchObject({ lat: 35.78, lng: -78.64 });
	expect(await placesSpend(B)).toEqual([{ model: "geocoding", cost: "0.005000" }]);
});
