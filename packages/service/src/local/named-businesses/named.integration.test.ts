import { brands, organization, promptRuns, prompts, runExtractions, runMentions, usageEvents } from "@workspace/lib/db/schema";
import type { RunMentionAssessments } from "@workspace/lib/mentions";
import { createOwnerDb } from "@workspace/lib/test/integration/owner-db";
import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlaceCandidate, PlacesProvider } from "../../providers/places";
import { deriveLocalMentions } from "../local-mentions";
import {
	answerNamedBusinesses,
	localMentions,
	placeAnchors,
	placeResolutions,
	runLocations,
	subjectServiceAreas,
} from "../schema";
import { withSubject } from "../tenancy";
import { type Extract, extractNamedBusinesses } from "./derive";
import { NAMED_BUSINESSES_VERSION } from "./extract";
import { PLACES_CALLS_PER_DAY, resolveNamedBusinesses } from "./resolve";

const ORG = "named-businesses-test-org";
const S = "named-businesses-test-s";
const SUBJECT_PLACE = "ChIJoakcityoakcity0001";

const owner = createOwnerDb();

/** Lists the businesses an answer names by the lines of its text that start with "- ". */
const listing: Extract = async (prompt) => {
	const answer = prompt.slice(prompt.indexOf("<answer>"), prompt.indexOf("</answer>"));
	const lines = answer.split("\n").filter((line) => line.startsWith("- "));
	const businesses = lines.map((line) => {
		const [name, phone] = line.slice(2).split(" | ");
		return { name, phone: phone ?? null, address: null, website: null };
	});
	return { object: { businesses }, modelVersion: "test-model" };
};

function placesWith(candidates: Record<string, PlaceCandidate[]>) {
	const searched: string[] = [];
	const provider: PlacesProvider = {
		async searchText(query) {
			searched.push(query);
			return { data: candidates[query] ?? [], sku: "text_search_enterprise" };
		},
		checkPlaceId: () => Promise.reject(new Error("not used")),
		mapsCid: () => Promise.reject(new Error("not used")),
		geocode: () => Promise.reject(new Error("not used")),
	};
	return { provider, searched };
}

const place = (name: string, placeId: string, lat: number, lng: number): PlaceCandidate => ({
	placeId,
	cid: null,
	name,
	phone: null,
	address: null,
	lat,
	lng,
	primaryType: "plumber",
	types: ["plumber"],
	mapsUrl: null,
});

async function saveRun(text: string | null): Promise<string> {
	const [prompt] = await owner.select({ id: prompts.id }).from(prompts).where(eq(prompts.brandId, S));
	const [run] = await owner
		.insert(promptRuns)
		.values({
			promptId: prompt.id,
			brandId: S,
			model: "claude",
			provider: "anthropic-api",
			version: "test",
			webSearchEnabled: true,
			rawOutput: {},
		})
		.returning({ id: promptRuns.id });
	await owner.insert(runExtractions).values({ runId: run.id, textContent: text });
	await owner.insert(runLocations).values({
		runId: run.id,
		subjectId: S,
		pointId: crypto.randomUUID(),
		requestedLocation: { pointId: "p", latitude: 35.78, longitude: -78.64, country: "US", timezone: "America/New_York" },
		locationMethod: "api_user_location",
		fidelityTier: "T4",
		businessesVersion: 1,
	});
	return run.id;
}

const extract = (fake: Extract, limit = 10) => withSubject(S, () => extractNamedBusinesses(fake, S, limit));
const resolve = (provider: PlacesProvider) => withSubject(S, () => resolveNamedBusinesses(provider, S, 10));
const namedIn = (runId: string) =>
	owner
		.select()
		.from(answerNamedBusinesses)
		.where(eq(answerNamedBusinesses.runId, runId))
		.orderBy(asc(answerNamedBusinesses.position));
const versionOf = async (runId: string) =>
	(await owner.select().from(runLocations).where(eq(runLocations.runId, runId)))[0].namedBusinessesVersion;

beforeAll(async () => {
	await cleanUp();
	await owner.insert(organization).values({ id: ORG, name: "Named Businesses Test", slug: ORG, createdAt: new Date() });
	await owner.insert(brands).values({ id: S, name: "Oak City Plumbing", website: "https://oakcity.example", organizationId: ORG });
	await owner.insert(prompts).values({ brandId: S, value: "best plumber near me" });
	await owner.insert(subjectServiceAreas).values({
		subjectId: S,
		name: "Raleigh",
		centerLat: 35.7796,
		centerLng: -78.6382,
		radiusMeters: 16000,
		isPrimary: true,
		timezone: "America/New_York",
	});
	await owner.insert(placeAnchors).values({
		subjectId: S,
		placeId: SUBJECT_PLACE,
		cid: null,
		searchQuery: "Oak City Plumbing",
		confirmedBy: "staff",
	});
});

afterAll(async () => {
	await cleanUp();
	await owner.$client.end();
});

async function cleanUp() {
	await owner.delete(usageEvents).where(eq(usageEvents.brandId, S));
	await owner.delete(promptRuns).where(eq(promptRuns.brandId, S));
	await owner.delete(prompts).where(eq(prompts.brandId, S));
	await owner.delete(brands).where(eq(brands.id, S));
	await owner.delete(organization).where(eq(organization.id, ORG));
}

describe("businesses named in located answers", () => {
	let first: string;
	let second: string;

	beforeAll(async () => {
		first = await saveRun("Try these:\n- Oak City Plumbing | (919) 555-0100\n- Harris Brothers Plumbing");
		second = await saveRun("Call:\n- Oak City Plumbing, LLC\n- Brothers Plumbing");
	});

	it("lists each answer's businesses once, in the order named", async () => {
		expect(await extract(listing)).toEqual({ extracted: 2, failed: [] });
		expect(await namedIn(first)).toEqual([
			expect.objectContaining({ subjectId: S, position: 1, name: "Oak City Plumbing", phone: "+19195550100" }),
			expect.objectContaining({ position: 2, name: "Harris Brothers Plumbing", nameKey: "harris brothers plumbing" }),
		]);
		expect(await versionOf(first)).toBe(NAMED_BUSINESSES_VERSION);
		expect(await extract(listing)).toEqual({ extracted: 0, failed: [] });
	});

	it("stamps a run with no text, or one the model can't list, with no businesses", async () => {
		const silent = await saveRun(null);
		const garbled = await saveRun("- Somebody");
		const unreadable: Extract = async () => {
			throw Object.assign(new Error("no object"), { name: "AI_NoObjectGeneratedError" });
		};
		const result = await extract(unreadable);
		expect(result.extracted).toBe(2);
		expect(result.failed.map(({ runId }) => runId)).toEqual([garbled]);
		expect(await namedIn(silent)).toEqual([]);
		expect(await versionOf(garbled)).toBe(NAMED_BUSINESSES_VERSION);
		await owner.delete(promptRuns).where(inArray(promptRuns.id, [silent, garbled]));
	});

	it("leaves a run for the next tick when the LLM is down", async () => {
		const later = await saveRun("- Somebody");
		const down: Extract = async () => {
			throw new Error("503 Service Unavailable");
		};
		await expect(extract(down)).rejects.toThrow("503");
		expect(await versionOf(later)).toBeNull();
		await owner.delete(promptRuns).where(eq(promptRuns.id, later));
	});

	it("looks each name up once near the subject's areas, and ties the subject's mention to its listing", async () => {
		const sure = { mentioned: true, probability: 0.9, sentiment: "positive" } as const;
		const assessments: RunMentionAssessments = { brand: sure, competitors: {}, judged: { brand: "b", competitors: {} } };
		await owner.insert(runMentions).values(
			[first, second].map((runId) => ({ runId, brandMentioned: true, assessments, stamp: "judge-1" })),
		);
		const match = () => withSubject(S, () => deriveLocalMentions(S, 100));
		const subjectRow = async (runId: string) =>
			(await owner.select().from(localMentions).where(eq(localMentions.runId, runId)))[0];
		expect(await match()).toBe(2);
		expect(await subjectRow(second)).toMatchObject({ method: "text+jev", review: "unresolved" });

		const { provider, searched } = placesWith({
			"Oak City Plumbing": [place("Oak City Plumbing", SUBJECT_PLACE, 35.79, -78.65)],
			"Oak City Plumbing, LLC": [place("Oak City Plumbing", SUBJECT_PLACE, 35.79, -78.65)],
			"Brothers Plumbing": [place("Brothers Plumbing", "ChIJbrothersdenver001", 39.74, -104.99)],
		});
		expect(await resolve(provider)).toEqual({ looked: 4, matched: 1 });
		// The phone the first answer gives makes it another name to look up; that listing has none.
		expect(searched.sort()).toEqual([
			"Brothers Plumbing",
			"Harris Brothers Plumbing",
			"Oak City Plumbing",
			"Oak City Plumbing, LLC",
		]);
		const resolutions = await owner
			.select()
			.from(placeResolutions)
			.where(eq(placeResolutions.subjectId, S))
			.orderBy(asc(placeResolutions.nameKey), asc(placeResolutions.phone));
		expect(resolutions.map(({ nameKey, phone, resolution }) => [nameKey, phone, resolution])).toEqual([
			["brothers plumbing", null, "elsewhere"],
			["harris brothers plumbing", null, "none"],
			["oak city plumbing", "+19195550100", "none"],
			["oak city plumbing", null, "matched"],
		]);
		const calls = await owner.select().from(usageEvents).where(eq(usageEvents.brandId, S));
		expect(calls.filter((call) => call.eventType === "places_call")).toHaveLength(4);

		expect(await resolve(provider)).toEqual({ looked: 0, matched: 0 });
		expect(await match()).toBe(2);
		expect(await subjectRow(second)).toMatchObject({ counted: true, method: "resolved", confidence: 0.9, review: null });
		expect(await subjectRow(first)).toMatchObject({ method: "text+jev", review: "unresolved" });
	});

	it("stops looking names up once the day's allowance is spent", async () => {
		await owner.delete(placeResolutions).where(eq(placeResolutions.subjectId, S));
		const spent = Array.from({ length: PLACES_CALLS_PER_DAY }, () => ({
			organizationId: ORG,
			brandId: S,
			eventType: "places_call",
			provider: "google-places",
		}));
		await owner.insert(usageEvents).values(spent);
		const { provider, searched } = placesWith({});
		expect(await resolve(provider)).toEqual({ looked: 0, matched: 0 });
		expect(searched).toEqual([]);
	});
});
