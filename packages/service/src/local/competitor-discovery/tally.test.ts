import { describe, expect, it } from "vitest";
import { competitorDomain, isSubjectName, namesByPlace, type Sighting, serviceRuns, tallySightings } from "./tally";

const sighting = (runId: string, fields: Partial<Sighting> = {}): Sighting => ({
	runId,
	areaId: "raleigh",
	tags: [],
	placeId: "oak-city",
	cid: null,
	name: "Oak City Plumbing",
	website: null,
	...fields,
});

describe("tallySightings", () => {
	it("counts each run once per business and area, by the services its prompt is tagged with", () => {
		const tallies = tallySightings(
			[
				sighting("r1", { tags: ["service:Plumber"] }),
				sighting("r1", { tags: ["service:Plumber"], name: "Oak City Plumbing LLC" }),
				sighting("r2", { tags: ["service:water heater repair", "near-me"] }),
				sighting("r3", { tags: ["service:plumber"] }),
				sighting("r4", { tags: ["emergency"] }),
				sighting("r5", { areaId: "durham" }),
			],
			["plumber", "Water Heater Repair"],
		);
		const raleigh = tallies.get("raleigh")?.get("oak-city");
		expect(raleigh?.runs.size).toBe(4);
		expect(Object.fromEntries([...(raleigh?.runsByService ?? [])].map(([service, runs]) => [service, runs.size]))).toEqual(
			{ plumber: 2, "Water Heater Repair": 1, "": 1 },
		);
		expect(raleigh && serviceRuns(raleigh)).toBe(2);
		expect(tallies.get("durham")?.get("oak-city")?.runs.size).toBe(1);
	});

	it("keeps a website only when its domain can stand for the business", () => {
		const tallies = tallySightings(
			[
				sighting("r1", { website: "https://www.yelp.com/biz/oak-city-plumbing" }),
				sighting("r2", { website: "https://oakcityplumbing.example/" }),
			],
			[],
		);
		expect(tallies.get("raleigh")?.get("oak-city")?.website).toBe("https://oakcityplumbing.example/");
	});
});

describe("namesByPlace", () => {
	it("orders how answers write a name by the runs that use it, treating case and punctuation as the same", () => {
		const names = namesByPlace([
			sighting("r1", { name: "Roto-Rooter Plumbing & Water Cleanup" }),
			sighting("r2", { name: "Roto-Rooter" }),
			sighting("r3", { name: "roto rooter" }),
			sighting("r3", { name: "Roto-Rooter" }),
		]);
		expect(names.get("oak-city")).toEqual(["Roto-Rooter", "Roto-Rooter Plumbing & Water Cleanup"]);
	});
});

describe("isSubjectName", () => {
	const subject = { name: "Oak City Plumbing", aliases: ["OCP"] };

	it("recognizes the subject's name, its aliases and its longer listings", () => {
		expect(isSubjectName("Oak City Plumbing, LLC", subject)).toBe(true);
		expect(isSubjectName("Oak City Plumbing of Cary", subject)).toBe(true);
		expect(isSubjectName("ocp", subject)).toBe(true);
	});

	it("doesn't take a business whose name only contains the subject's for the subject", () => {
		expect(isSubjectName("Best Oak City Plumbing", subject)).toBe(false);
	});
});

describe("competitorDomain", () => {
	it("keeps a business's own domain and drops directories, social pages and Google links", () => {
		expect(competitorDomain("https://www.oakcityplumbing.example/raleigh")).toBe("oakcityplumbing.example");
		expect(competitorDomain("https://www.facebook.com/oakcityplumbing")).toBeNull();
		expect(competitorDomain("https://www.yelp.com/biz/oak-city-plumbing")).toBeNull();
		expect(competitorDomain("https://maps.google.com/?cid=123")).toBeNull();
		expect(competitorDomain(null)).toBeNull();
	});
});
