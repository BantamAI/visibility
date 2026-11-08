import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	googleCanonicalName,
	parseGazetteerPlaces,
	parseUsCityGeotargets,
	placeNameWithoutDescription,
} from "./reference-places";

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

const places = parseGazetteerPlaces(fixture("gazetteer-places-2025.txt"));
const cities = parseUsCityGeotargets(fixture("geotargets-excerpt.csv"));
const place = (name: string) => {
	const found = places.find((p) => p.name === name);
	if (!found) throw new Error(`No fixture place called ${name}`);
	return found;
};

describe("Census place names", () => {
	it.each([
		["Raleigh city", "Raleigh"],
		["Cary town", "Cary"],
		["Town 'n' Country CDP", "Town 'n' Country"],
		["Boise City city", "Boise City"],
		["Nashville-Davidson metropolitan government (balance)", "Nashville-Davidson"],
		["San Buenaventura (Ventura) city", "San Buenaventura (Ventura)"],
	])("reads %s as %s", (census, spoken) => {
		expect(placeNameWithoutDescription(census)).toBe(spoken);
	});
});

describe("parseGazetteerPlaces", () => {
	it("reads the pipe-separated gazetteer", () => {
		expect(place("Raleigh")).toEqual({
			geoid: "3755000",
			name: "Raleigh",
			state: "NC",
			lat: 35.831868,
			lng: -78.641042,
			landAreaM2: 394359593,
		});
		expect(places).toHaveLength(12);
	});

	it("reads older tab-separated vintages", () => {
		const tabbed = [
			"USPS\tGEOID\tANSICODE\tNAME\tLSAD\tFUNCSTAT\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG                                                                                                               ",
			"NC\t3710740\t02406229\tCary town\t43\tA\t150000000\t2800000\t57.9\t1.1\t35.781302\t-78.823444",
		].join("\n");
		expect(parseGazetteerPlaces(tabbed)).toEqual([
			{ geoid: "3710740", name: "Cary", state: "NC", lat: 35.781302, lng: -78.823444, landAreaM2: 150000000 },
		]);
	});

	it("refuses a file that isn't a places gazetteer", () => {
		expect(() => parseGazetteerPlaces("GEOID|NAME\n1|x")).toThrow(/USPS/);
	});
});

describe("googleCanonicalName", () => {
	it("keeps only active US cities from the geotargets list", () => {
		expect(cities.has("Raleigh,North Carolina,United States")).toBe(true);
		expect(cities.has("Raleigh,Tennessee,United States")).toBe(false);
		expect(cities.has("Raleigh,New South Wales,Australia")).toBe(false);
		expect(cities.has("North Carolina,United States")).toBe(false);
	});

	it.each([
		["Raleigh", "Raleigh,North Carolina,United States"],
		["Town 'n' Country", "Town 'n' Country,Florida,United States"],
		["Nashville-Davidson", "Nashville,Tennessee,United States"],
		["San Buenaventura (Ventura)", "Ventura,California,United States"],
		["Boise City", "Boise,Idaho,United States"],
		["St. Stephens", "Saint Stephens,North Carolina,United States"],
	])("resolves %s to %s", (name, canonical) => {
		expect(googleCanonicalName(place(name), cities)).toBe(canonical);
	});

	it("leaves places Google doesn't target unnamed", () => {
		expect(googleCanonicalName({ name: "Nowhere Junction", state: "NC" }, cities)).toBeNull();
		expect(googleCanonicalName({ name: "Raleigh", state: "ZZ" }, cities)).toBeNull();
	});
});
