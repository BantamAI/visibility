import { readFileSync } from "node:fs";
import { db } from "@workspace/lib/db/db";
import { brands, organization } from "@workspace/lib/db/schema";
import { createOwnerDb } from "@workspace/lib/test/integration/owner-db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { refUsPlaces, refUsZctas } from "../schema";
import { withSubject } from "../tenancy";
import { googleCanonicalName, parseGazetteerPlaces, parseUsCityGeotargets } from "./reference-places";
import { parseGazetteerZctas, parseZctaPopulation } from "./reference-zctas";
import { deleteServiceArea, listServiceAreas, type ServiceAreaInput, saveServiceArea } from "./service-areas";

const ORG = "service-areas-test-org";
const A = "service-areas-test-a";
const B = "service-areas-test-b";

const owner = createOwnerDb();
const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
const cities = parseUsCityGeotargets(fixture("geotargets-excerpt.csv"));
const places = parseGazetteerPlaces(fixture("gazetteer-places-2025.txt"));
const zctas = parseGazetteerZctas(fixture("gazetteer-zcta-2025.txt"));
const population = parseZctaPopulation(fixture("dhc-2020-p1-zcta.json"));

const raleigh: ServiceAreaInput = {
	name: "Raleigh",
	centerLat: 35.7796,
	centerLng: -78.6382,
	radiusMeters: 20_000,
	timezone: "America/New_York",
};

beforeAll(async () => {
	await cleanUp();
	await owner.insert(organization).values({ id: ORG, name: "Service Areas Test", slug: ORG, createdAt: new Date() });
	await owner.insert(brands).values([
		{ id: A, name: "Subject A", website: "https://a.example", organizationId: ORG },
		{ id: B, name: "Subject B", website: "https://b.example", organizationId: ORG },
	]);
	await owner
		.insert(refUsPlaces)
		.values(
			places.map((place) => ({ ...place, googleCanonicalName: googleCanonicalName(place, cities), vintage: 2025 })),
		)
		.onConflictDoNothing();
	await owner
		.insert(refUsZctas)
		.values(
			zctas.map((zcta) => ({
				...zcta,
				population: population.byZcta.get(zcta.zcta) ?? null,
				vintage: 2025,
				populationVintage: 2020,
			})),
		)
		.onConflictDoNothing();
});

afterAll(async () => {
	await cleanUp();
	await db.$client.end();
	await owner.$client.end();
});

async function cleanUp() {
	await owner.delete(brands).where(inArray(brands.id, [A, B]));
	await owner.delete(organization).where(eq(organization.id, ORG));
	await owner.delete(refUsPlaces).where(
		inArray(
			refUsPlaces.geoid,
			places.map((place) => place.geoid),
		),
	);
	await owner.delete(refUsZctas).where(
		inArray(
			refUsZctas.zcta,
			zctas.map((zcta) => zcta.zcta),
		),
	);
}

const areasOf = (subjectId: string) => withSubject(subjectId, () => listServiceAreas(subjectId));

describe("service areas", () => {
	it("generates grid, centroid and ZIP points ready for providers", async () => {
		await withSubject(A, () => saveServiceArea(A, raleigh));
		const [area] = await areasOf(A);
		expect(area).toMatchObject({ name: "Raleigh", isPrimary: true, gridSize: 3 });
		const active = area.samplePoints.filter((point) => point.active);
		expect(active.filter((point) => point.kind === "grid")).toHaveLength(9);
		expect(active.find((point) => point.label === "Raleigh, NC")).toMatchObject({
			kind: "centroid",
			city: "Raleigh",
			region: "NC",
			country: "US",
			timezone: "America/New_York",
			googleCanonicalName: "Raleigh,North Carolina,United States",
			postalCode: "27609",
		});
		const zips = active.filter((point) => point.kind === "zip");
		expect(zips).toHaveLength(12);
		expect(zips.find((point) => point.label === "27529")).toMatchObject({
			postalCode: "27529",
			city: "Garner",
			region: "NC",
			country: "US",
			timezone: "America/New_York",
		});
	});

	it("keeps point ids when an area is saved again unchanged", async () => {
		const [before] = await areasOf(A);
		await withSubject(A, () => saveServiceArea(A, raleigh, before.id));
		const [after] = await areasOf(A);
		expect(after.samplePoints.map((point) => point.id)).toEqual(before.samplePoints.map((point) => point.id));
	});

	it("deactivates points that no longer fit instead of deleting them", async () => {
		const [before] = await areasOf(A);
		await withSubject(A, () => saveServiceArea(A, { ...raleigh, radiusMeters: 8_000, gridSize: 5 }, before.id));
		const [after] = await areasOf(A);
		const old3x3 = after.samplePoints.filter((point) => point.label.startsWith("3x3"));
		expect(old3x3).toHaveLength(9);
		expect(old3x3.every((point) => !point.active)).toBe(true);
		expect(after.samplePoints.filter((point) => point.active && point.label.startsWith("5x5")).length).toBeGreaterThan(
			9,
		);
		expect(after.samplePoints.find((point) => point.label === "Cary, NC")?.active).toBe(false);
		expect(after.samplePoints.find((point) => point.label === "Raleigh, NC")?.active).toBe(true);
		expect(after.samplePoints.find((point) => point.label === "27529")?.active).toBe(false);
	});

	it("keeps one primary area per subject", async () => {
		const cary = await withSubject(A, () =>
			saveServiceArea(A, { ...raleigh, name: "Cary", centerLat: 35.7813, centerLng: -78.8234, isPrimary: true }),
		);
		expect((await areasOf(A)).map((area) => [area.name, area.isPrimary])).toEqual([
			["Raleigh", false],
			["Cary", true],
		]);
		await withSubject(A, () => deleteServiceArea(A, cary.id));
		expect((await areasOf(A)).map((area) => [area.name, area.isPrimary])).toEqual([["Raleigh", true]]);
	});

	it("refuses a second area with the same name", async () => {
		await expect(withSubject(A, () => saveServiceArea(A, raleigh))).rejects.toThrow(/already a service area/);
	});

	it("never shows or changes another subject's areas", async () => {
		const [areaA] = await areasOf(A);
		expect(await areasOf(B)).toEqual([]);
		await expect(withSubject(B, () => saveServiceArea(B, raleigh, areaA.id))).rejects.toThrow(/doesn't exist/);
		expect(await withSubject(B, () => deleteServiceArea(B, areaA.id))).toBe(false);
		expect(await withSubject(B, () => deleteServiceArea(A, areaA.id))).toBe(false);
		expect(await areasOf(A)).toHaveLength(1);
	});
});
