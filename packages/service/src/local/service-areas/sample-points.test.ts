import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { googleCanonicalName, parseGazetteerPlaces, parseUsCityGeotargets } from "./reference-places";
import { planSamplePoints, type ReferencePlace } from "./sample-points";

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
const cities = parseUsCityGeotargets(fixture("geotargets-excerpt.csv"));
const places: ReferencePlace[] = parseGazetteerPlaces(fixture("gazetteer-places-2025.txt")).map((place) => ({
	...place,
	googleCanonicalName: googleCanonicalName(place, cities),
}));

// Downtown Raleigh, 20 km out: takes in the centroids of Raleigh, Garner, Knightdale,
// Cary and Morrisville, but not Apex or Holly Springs.
const raleighArea = {
	centerLat: 35.7796,
	centerLng: -78.6382,
	radiusMeters: 20_000,
	polygon: null,
	gridSize: 3,
	timezone: "America/New_York",
	country: "US",
};

describe("planSamplePoints", () => {
	const points = planSamplePoints(raleighArea, places);
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
			postalCode: null,
			timezone: "America/New_York",
			googleCanonicalName: "Raleigh,North Carolina,United States",
		});
		for (const point of points) {
			expect(point).toMatchObject({ country: "US", timezone: "America/New_York" });
			expect(point.city).toBeTruthy();
			expect(point.region).toBe("NC");
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
		expect(planSamplePoints(raleighArea, [...places].reverse())).toEqual(points);
	});

	it("gives an area with no city centroid inside it the nearest city", () => {
		const small = { ...raleighArea, centerLat: 35.74, centerLng: -78.7, radiusMeters: 1_000 };
		expect(planSamplePoints(small, places).filter((point) => point.kind === "centroid")).toMatchObject([
			{ label: "Garner, NC" },
		]);
	});

	it("tells apart same-named places in one state", () => {
		const garner = places.find((place) => place.name === "Garner");
		if (!garner) throw new Error("The fixture has no Garner");
		const twin = { ...garner, geoid: "3799999", lat: 35.7, lng: -78.6 };
		const labels = planSamplePoints(raleighArea, [...places, twin]).map((point) => point.label);
		expect(labels).toContain("Garner, NC (3725480)");
		expect(labels).toContain("Garner, NC (3799999)");
	});

	it("still makes a grid where there's no reference data", () => {
		const abroad = planSamplePoints({ ...raleighArea, country: "CA" }, []);
		expect(abroad).toHaveLength(9);
		expect(abroad.every((point) => point.kind === "grid" && point.city === null && point.country === "CA")).toBe(true);
	});
});
