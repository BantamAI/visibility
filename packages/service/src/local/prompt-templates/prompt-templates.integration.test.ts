import { brands, organization, prompts } from "@workspace/lib/db/schema";
import { createOwnerDb } from "@workspace/lib/test/integration/owner-db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addService } from "../competitor-discovery/manage";
import { cityTag } from "../run-planner/constants";
import { samplePoints, subjectServiceAreas } from "../schema";
import { withSubject } from "../tenancy";
import { draftLocalPrompts, LocalPromptError, listAreaCities, setServiceJobs } from "./manage";

const ORG = "prompt-templates-test-org";
const S = "prompt-templates-test-s";
const OTHER = "prompt-templates-test-other";
const RALEIGH = cityTag("Raleigh", "NC");
const CARY = cityTag("Cary", "NC");

const owner = createOwnerDb();
let plumber: string;
let otherService: string;

async function addArea(subjectId: string, cities: { city: string; lat: number }[]) {
	const [area] = await owner
		.insert(subjectServiceAreas)
		.values({
			subjectId,
			name: "Triangle",
			centerLat: 35.78,
			centerLng: -78.64,
			radiusMeters: 20000,
			isPrimary: true,
			timezone: "America/New_York",
		})
		.returning();
	await owner.insert(samplePoints).values(
		cities.map(({ city, lat }) => ({
			subjectId,
			areaId: area.id,
			kind: "centroid" as const,
			label: city,
			lat,
			lng: -78.64,
			city,
			region: "NC",
			country: "US",
			timezone: "America/New_York",
		})),
	);
}

beforeAll(async () => {
	await cleanUp();
	await owner.insert(organization).values({ id: ORG, name: "Templates Test", slug: ORG, createdAt: new Date() });
	await owner.insert(brands).values([
		{ id: S, name: "Oak City Plumbing", website: "https://oakcity.example", organizationId: ORG },
		{ id: OTHER, name: "Elsewhere Roofing", website: "https://elsewhere.example", organizationId: ORG },
	]);
	await addArea(S, [
		{ city: "Cary", lat: 35.79 },
		{ city: "Raleigh", lat: 35.781 },
	]);
	plumber = (await withSubject(S, () => addService(S, "plumber"))).id;
	otherService = (await withSubject(OTHER, () => addService(OTHER, "roofer"))).id;
	await owner.insert(prompts).values({ brandId: S, value: "who is the best plumber near me?" });
});

afterAll(async () => {
	await cleanUp();
	await owner.$client.end();
});

async function cleanUp() {
	for (const id of [S, OTHER]) {
		await owner.delete(prompts).where(eq(prompts.brandId, id));
		await owner.delete(brands).where(eq(brands.id, id));
	}
	await owner.delete(organization).where(eq(organization.id, ORG));
}

describe("local prompt templates", () => {
	it("lists each area's cities with the one nearest the center as its main city", async () => {
		const [area] = await withSubject(S, () => listAreaCities(S));
		expect(area?.cities.map((c) => [c.tag, c.main])).toEqual([
			[RALEIGH, true],
			[CARY, false],
		]);
	});

	it("stores a service's jobs, trimmed and without repeats", async () => {
		const jobs = await withSubject(S, () =>
			setServiceJobs(S, plumber, [" water heater  replacement ", "Water Heater Replacement", "", "drain cleaning"]),
		);
		expect(jobs).toEqual(["water heater replacement", "drain cleaning"]);
	});

	it("won't change another subject's service", async () => {
		await expect(withSubject(S, () => setServiceJobs(S, otherService, ["gutters"]))).rejects.toThrow(LocalPromptError);
	});

	it("drafts every prompt for the picked cities and marks those the subject already has", async () => {
		const draft = await withSubject(S, () => draftLocalPrompts(S, [CARY]));
		expect(draft.existingCount).toBe(1);
		// (4 intents + 2 jobs) × (near me + Cary) + 2 fact prompts placed in the main city.
		expect(draft.prompts).toHaveLength(14);
		expect(draft.prompts.filter((p) => p.exists).map((p) => p.value)).toEqual(["Who is the best plumber near me?"]);
		expect(draft.prompts.filter((p) => p.tags.includes("branded")).every((p) => p.tags.includes(RALEIGH))).toBe(true);
	});

	it("refuses a city outside the subject's areas", async () => {
		await expect(withSubject(S, () => draftLocalPrompts(S, [cityTag("Denver", "CO")]))).rejects.toThrow(
			LocalPromptError,
		);
	});
});
