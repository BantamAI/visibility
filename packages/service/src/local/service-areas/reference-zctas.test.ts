import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseGazetteerZctas, parseZctaPopulation } from "./reference-zctas";

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

describe("parseGazetteerZctas", () => {
	const zctas = parseGazetteerZctas(fixture("gazetteer-zcta-2025.txt"));

	it("reads each ZCTA's internal point and land area", () => {
		expect(zctas.find((zcta) => zcta.zcta === "27601")).toEqual({
			zcta: "27601",
			lat: 35.773661,
			lng: -78.634563,
			landAreaM2: 4709755,
		});
		expect(zctas).toHaveLength(33);
	});

	it("keeps leading zeros", () => {
		const [zcta] = parseGazetteerZctas("GEOID\tALAND\tINTPTLAT\tINTPTLONG\n00601\t166836450\t18.180555\t-66.749961\n");
		expect(zcta.zcta).toBe("00601");
	});
});

describe("parseZctaPopulation", () => {
	it("reads a data.census.gov table and its year", () => {
		const population = parseZctaPopulation(fixture("dhc-2020-p1-zcta.json"));
		expect(population.vintage).toBe(2020);
		expect(population.byZcta.get("27601")).toBe(9965);
		expect(population.byZcta.get("27697")).toBe(0);
		expect(population.byZcta.size).toBe(33);
	});

	it("reads an api.census.gov response, which carries no year", () => {
		const json = JSON.stringify([
			["P1_001N", "zip code tabulation area"],
			["9965", "27601"],
			["17242", "00601"],
		]);
		expect(parseZctaPopulation(json)).toEqual({
			vintage: null,
			byZcta: new Map([
				["27601", 9965],
				["00601", 17242],
			]),
		});
	});

	it("refuses a table without population", () => {
		expect(() => parseZctaPopulation(JSON.stringify([["P2_001N", "zip code tabulation area"]]))).toThrow(/P1_001N/);
	});
});
