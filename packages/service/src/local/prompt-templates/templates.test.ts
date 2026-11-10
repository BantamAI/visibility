import { describe, expect, it } from "vitest";
import { cityTag, NEAR_ME_TAG } from "../run-planner/constants";
import { citiesByArea, factCityOf } from "./cities";
import { generateLocalPrompts, SERVICE_INTENTS } from "./templates";

const raleigh = { city: "Raleigh", region: "NC" };
const cary = { city: "Cary", region: "NC" };

const generate = (overrides: Partial<Parameters<typeof generateLocalPrompts>[0]> = {}) =>
	generateLocalPrompts({
		business: "Acme Plumbing",
		services: [{ name: "plumber", jobs: ["water heater replacement"] }],
		cities: [raleigh],
		factCity: raleigh,
		...overrides,
	});

const values = (prompts: ReturnType<typeof generate>) => prompts.map((p) => p.value);

describe("generateLocalPrompts", () => {
	it("asks every service with all four intents, near me and in each city", () => {
		const service = generate({ factCity: null, services: [{ name: "plumber", jobs: [] }] });
		expect(values(service)).toEqual([
			"I need an emergency plumber near me. Who should I call?",
			"How much does a plumber near me charge?",
			"Who is the best plumber near me?",
			"Which plumber near me has the best reviews?",
			"I need an emergency plumber in Raleigh, NC. Who should I call?",
			"How much does a plumber in Raleigh, NC charge?",
			"Who is the best plumber in Raleigh, NC?",
			"Which plumber in Raleigh, NC has the best reviews?",
		]);
		for (const intent of SERVICE_INTENTS) {
			expect(service.filter((p) => p.tags.includes(`intent:${intent}`))).toHaveLength(2);
		}
	});

	it("tags each prompt with its type, service, intent and phrasing", () => {
		const [nearMe] = generate();
		expect(nearMe?.tags).toEqual(["unbranded", "service:plumber", "intent:emergency", NEAR_ME_TAG]);
		const inRaleigh = generate().find((p) => p.value === "Who is the best plumber in Raleigh, NC?");
		expect(inRaleigh?.tags).toEqual([
			"unbranded",
			"service:plumber",
			"intent:best",
			"city-named",
			cityTag("Raleigh", "NC"),
		]);
	});

	it("asks for each job under its service, in every phrasing", () => {
		const jobs = generate({ cities: [raleigh, cary] }).filter((p) => p.tags.includes("intent:job"));
		expect(values(jobs)).toEqual([
			"Who can I hire for water heater replacement near me?",
			"Who can I hire for water heater replacement in Raleigh, NC?",
			"Who can I hire for water heater replacement in Cary, NC?",
		]);
		expect(jobs.every((p) => p.tags.includes("service:plumber"))).toBe(true);
	});

	it("asks the branded fact questions once, in the fact city", () => {
		const facts = generate({ cities: [raleigh, cary] }).filter((p) => p.tags.includes("branded"));
		expect(facts).toEqual([
			{
				value: "Is Acme Plumbing in Raleigh, NC licensed?",
				tags: ["branded", "city-named", cityTag("Raleigh", "NC"), "intent:licensed"],
			},
			{
				value: "What are the hours for Acme Plumbing in Raleigh, NC?",
				tags: ["branded", "city-named", cityTag("Raleigh", "NC"), "intent:hours"],
			},
		]);
	});

	it("asks only near-me prompts and facts when no city is picked", () => {
		const prompts = generate({ cities: [] });
		expect(prompts.filter((p) => p.tags.includes("city-named") && !p.tags.includes("branded"))).toEqual([]);
		expect(prompts).toHaveLength(SERVICE_INTENTS.length + 1 + 2);
	});

	it("uses the article that fits the service", () => {
		const cost = (name: string) =>
			generate({ services: [{ name, jobs: [] }], cities: [], factCity: null }).find((p) =>
				p.tags.includes("intent:cost"),
			)?.value;
		expect(cost("electrician")).toBe("How much does an electrician near me charge?");
		expect(cost("HVAC company")).toBe("How much does an HVAC company near me charge?");
		expect(cost("roofer")).toBe("How much does a roofer near me charge?");
	});

	it("drops repeats", () => {
		const prompts = generate({
			cities: [raleigh, raleigh],
			services: [{ name: "plumber", jobs: ["leak repair", "Leak Repair"] }],
		});
		expect(prompts).toHaveLength((SERVICE_INTENTS.length + 1) * 2 + 2);
	});
});

describe("citiesByArea", () => {
	const area = { id: "a", name: "Triangle", isPrimary: false, centerLat: 35.78, centerLng: -78.64 };
	const centroid = (city: string, lat: number) => ({ areaId: "a", city, region: "NC", lat, lng: -78.64 });

	it("lists an area's cities nearest the center first, the nearest as its main city", () => {
		const [triangle] = citiesByArea(
			[area],
			[centroid("Cary", 35.9), centroid("Raleigh", 35.79), centroid("Garner", 35.7)],
		);
		expect(triangle?.cities.map((c) => [c.city, c.main])).toEqual([
			["Raleigh", true],
			["Garner", false],
			["Cary", false],
		]);
	});

	it("places the fact prompts in the primary area's main city", () => {
		const primary = { ...area, id: "p", name: "Durham", isPrimary: true };
		const areas = citiesByArea(
			[area, primary],
			[centroid("Raleigh", 35.78), { ...centroid("Durham", 35.78), areaId: "p" }],
		);
		expect(factCityOf(areas)?.city).toBe("Durham");
	});
});
