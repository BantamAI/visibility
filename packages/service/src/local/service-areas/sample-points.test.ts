import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { googleCanonicalName, parseGazetteerPlaces, parseUsCityGeotargets } from "./reference-places";
import { parseGazetteerZctas, parseZctaPopulation } from "./reference-zctas";
import { planSamplePoints, type ReferencePlace, type ReferenceZcta } from "./sample-points";

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
const cities = parseUsCityGeotargets(fixture("geotargets-excerpt.csv"));
const places: ReferencePlace[] = parseGazetteerPlaces(fixture("gazetteer-places-2025.txt")).map((place) => ({
	...place,
	googleCanonicalName: googleCanonicalName(place, cities),
}));
const population = parseZctaPopulation(fixture("dhc-2020-p1-zcta.json"));
const zctas: ReferenceZcta[] = parseGazetteerZctas(fixture("gazetteer-zcta-2025.txt")).map((zcta) => ({
	...zcta,
	population: population.byZcta.get(zcta.zcta) ?? null,
}));

// Downtown Raleigh, 20 km out: takes in the centroids of Raleigh, Garner, Knightdale,
// Cary and Morrisville, but not Apex or Holly Springs.
const raleighArea = {
	centerLat: 35.7796,
	centerLng: -78.6382,
	radiusMeters: 20_000,
	polygon: null,
	gridSize: 3,
	zipPointLimit: 12,
	timezone: "America/New_York",
	country: "US",
};

describe("planSamplePoints", () => {
	const points = planSamplePoints(raleighArea, places, zctas);
	const centroids = points.filter((point) => point.kind === "centroid");
	const grid = points.filter((point) => point.kind === "grid");

	it("makes one centroid per city in the area, nearest the center first", () => {
		expect(centroids.map((point) => point.label)).toEqual([
			"Raleigh, NC",
			"Garner, NC",
			"Knightdale, NC",
			"Cary, NC",
			"Morrisville, NC",
		]);
	});

	it("gives every point the fields providers send, with no lookup at run time", () => {
		expect(centroids[0]).toEqual({
			kind: "centroid",
			label: "Raleigh, NC",
			lat: 35.831868,
			lng: -78.641042,
			city: "Raleigh",
			region: "NC",
			country: "US",
			postalCode: "27609",
			timezone: "America/New_York",
			googleCanonicalName: "Raleigh,North Carolina,United States",
		});
		for (const point of points) {
			expect(point).toMatchObject({ country: "US", timezone: "America/New_York" });
			expect(point.city).toBeTruthy();
			expect(point.region).toBe("NC");
			expect(point.postalCode).toMatch(/^\d{5}$/);
		}
	});

	it("names grid points by size and cell, and places each in its nearest city", () => {
		expect(grid.map((point) => point.label)).toEqual([
			"3x3 R1C1",
			"3x3 R1C2",
			"3x3 R1C3",
			"3x3 R2C1",
			"3x3 R2C2",
			"3x3 R2C3",
			"3x3 R3C1",
			"3x3 R3C2",
			"3x3 R3C3",
		]);
		expect(grid.find((point) => point.label === "3x3 R2C2")?.city).toBe("Raleigh");
		expect(grid.find((point) => point.label === "3x3 R2C1")?.city).toBe("Cary");
		expect(grid.find((point) => point.label === "3x3 R2C3")?.city).toBe("Knightdale");
	});

	it("is deterministic", () => {
		expect(planSamplePoints(raleighArea, [...places].reverse(), [...zctas].reverse())).toEqual(points);
	});

	it("gives an area with no city centroid inside it the nearest city", () => {
		const small = { ...raleighArea, centerLat: 35.74, centerLng: -78.7, radiusMeters: 1_000 };
		expect(planSamplePoints(small, places, zctas).filter((point) => point.kind === "centroid")).toMatchObject([
			{ label: "Garner, NC" },
		]);
	});

	it("tells apart same-named places in one state", () => {
		const garner = places.find((place) => place.name === "Garner");
		if (!garner) throw new Error("The fixture has no Garner");
		const twin = { ...garner, geoid: "3799999", lat: 35.7, lng: -78.6 };
		const labels = planSamplePoints(raleighArea, [...places, twin], zctas).map((point) => point.label);
		expect(labels).toContain("Garner, NC (3725480)");
		expect(labels).toContain("Garner, NC (3799999)");
	});

	it("still makes a grid where there's no reference data", () => {
		const abroad = planSamplePoints({ ...raleighArea, country: "CA" }, [], []);
		expect(abroad).toHaveLength(9);
		expect(abroad.every((point) => point.kind === "grid" && point.city === null && point.country === "CA")).toBe(true);
	});
});

describe("ZIP grid", () => {
	const zips = planSamplePoints(raleighArea, places, zctas).filter((point) => point.kind === "zip");

	it("keeps the most populous ZIPs whose centroid falls in the area, up to the limit", () => {
		expect(zips.map((point) => point.label)).toEqual([
			"27610",
			"27616",
			"27603",
			"27529",
			"27606",
			"27613",
			"27513",
			"27604",
			"27615",
			"27612",
			"27560",
			"27609",
		]);
	});

	it("fills the fields egress routes target", () => {
		expect(zips.find((point) => point.label === "27529")).toEqual({
			kind: "zip",
			label: "27529",
			lat: 35.638625,
			lng: -78.581384,
			city: "Garner",
			region: "NC",
			country: "US",
			postalCode: "27529",
			timezone: "America/New_York",
			googleCanonicalName: "Garner,North Carolina,United States",
		});
	});

	it("follows the area's limit", () => {
		const few = planSamplePoints({ ...raleighArea, zipPointLimit: 3 }, places, zctas);
		expect(few.filter((point) => point.kind === "zip").map((point) => point.label)).toEqual([
			"27610",
			"27616",
			"27603",
		]);
	});

	it("leaves out ZIPs where nobody lives", () => {
		// 27697 sits 1.4 km from the center with a population of zero.
		const all = planSamplePoints({ ...raleighArea, zipPointLimit: 50 }, places, zctas);
		const labels = all.filter((point) => point.kind === "zip").map((point) => point.label);
		expect(labels).toHaveLength(23);
		expect(labels).not.toContain("27697");
	});

	it("ranks by land area when population isn't loaded", () => {
		const unpopulated = zctas.map((zcta) => ({ ...zcta, population: null }));
		const few = planSamplePoints({ ...raleighArea, zipPointLimit: 3 }, places, unpopulated);
		expect(few.filter((point) => point.kind === "zip").map((point) => point.label)).toEqual([
			"27529",
			"27603",
			"27610",
		]);
	});

	it("gives an area with no populated ZIP centroid inside it the nearest populated one", () => {
		const around27697 = { ...raleighArea, centerLat: 35.778803, centerLng: -78.622967, radiusMeters: 500 };
		expect(planSamplePoints(around27697, places, zctas).filter((point) => point.kind === "zip")).toMatchObject([
			{ label: "27601" },
		]);
	});

	it("makes none outside the US", () => {
		expect(planSamplePoints({ ...raleighArea, country: "CA" }, [], []).some((point) => point.kind === "zip")).toBe(
			false,
		);
	});
});
