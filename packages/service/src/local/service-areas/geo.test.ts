import { describe, expect, it } from "vitest";
import type { AreaPolygon } from "../schema";
import { coordinateGrid, distanceMeters, insidePolygon, parseAreaPolygon } from "./geo";

const raleigh = { centerLat: 35.7796, centerLng: -78.6382, radiusMeters: 16_000 };

describe("coordinateGrid", () => {
	it("keeps a whole 3×3 grid inside the radius", () => {
		const grid = coordinateGrid(raleigh, 3);
		expect(grid).toHaveLength(9);
		for (const cell of grid) {
			expect(distanceMeters({ lat: raleigh.centerLat, lng: raleigh.centerLng }, cell)).toBeLessThanOrEqual(
				raleigh.radiusMeters,
			);
		}
	});

	it("puts the middle cell on the center and orders cells north-west first", () => {
		const grid = coordinateGrid(raleigh, 3);
		expect(grid[4]).toMatchObject({ row: 1, col: 1, lat: raleigh.centerLat, lng: raleigh.centerLng });
		expect(grid[0].lat).toBeGreaterThan(grid[8].lat);
		expect(grid[0].lng).toBeLessThan(grid[8].lng);
	});

	it("drops the corners of larger grids that fall outside the circle", () => {
		const grid = coordinateGrid(raleigh, 7);
		expect(grid.length).toBeLessThan(49);
		expect(grid.some((cell) => cell.row === 0 && cell.col === 0)).toBe(false);
		expect(grid.some((cell) => cell.row === 3 && cell.col === 3)).toBe(true);
	});

	it("spaces cells evenly across the area", () => {
		const grid = coordinateGrid(raleigh, 5);
		const middleRow = grid.filter((cell) => cell.row === 2);
		const gaps = middleRow.slice(1).map((cell, i) => distanceMeters(middleRow[i], cell));
		for (const gap of gaps) expect(Math.abs(gap / ((2 * raleigh.radiusMeters) / 5) - 1)).toBeLessThan(0.01);
	});

	it("makes the same points every time", () => {
		expect(coordinateGrid(raleigh, 5)).toEqual(coordinateGrid({ ...raleigh }, 5));
	});

	it("clips to the polygon when one is set", () => {
		// The area east of its middle column.
		const east: AreaPolygon = {
			type: "Polygon",
			coordinates: [
				[
					[-78.62, 35.5],
					[-78.3, 35.5],
					[-78.3, 36.1],
					[-78.62, 36.1],
					[-78.62, 35.5],
				],
			],
		};
		const grid = coordinateGrid({ ...raleigh, polygon: east }, 3);
		expect(grid.map((cell) => cell.col)).toEqual([2, 2, 2]);
	});

	it.each([2, 8, 4.5])("refuses a %s grid", (size) => {
		expect(() => coordinateGrid(raleigh, size)).toThrow(RangeError);
	});
});

describe("insidePolygon", () => {
	const square = (lng: number, lat: number, half: number) => [
		[lng - half, lat - half],
		[lng + half, lat - half],
		[lng + half, lat + half],
		[lng - half, lat + half],
		[lng - half, lat - half],
	];

	it("excludes holes", () => {
		const donut = { type: "Polygon", coordinates: [square(0, 0, 1), square(0, 0, 0.5)] } as AreaPolygon;
		expect(insidePolygon({ lat: 0, lng: 0 }, donut)).toBe(false);
		expect(insidePolygon({ lat: 0.75, lng: 0 }, donut)).toBe(true);
	});

	it("accepts any part of a multipolygon", () => {
		const two = { type: "MultiPolygon", coordinates: [[square(0, 0, 1)], [square(10, 10, 1)]] } as AreaPolygon;
		expect(insidePolygon({ lat: 10, lng: 10 }, two)).toBe(true);
		expect(insidePolygon({ lat: 5, lng: 5 }, two)).toBe(false);
	});
});

describe("parseAreaPolygon", () => {
	const ring = [
		[-78.7, 35.7],
		[-78.5, 35.7],
		[-78.5, 35.9],
		[-78.7, 35.7],
	];

	it("unwraps a GeoJSON feature", () => {
		expect(
			parseAreaPolygon({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }),
		).toEqual({ type: "Polygon", coordinates: [ring] });
	});

	it.each([
		["a point", { type: "Point", coordinates: [-78.6, 35.8] }],
		["a ring with too few positions", { type: "Polygon", coordinates: [ring.slice(0, 3)] }],
		["positions off the globe", { type: "Polygon", coordinates: [ring.map(([lng, lat]) => [lng * 3, lat])] }],
		["nothing", null],
	])("refuses %s", (_, input) => {
		expect(() => parseAreaPolygon(input)).toThrow(/GeoJSON/);
	});
});
