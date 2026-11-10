import { readFileSync } from "node:fs";
import { db } from "@workspace/lib/db/db";
import { brands, competitors, organization, promptRuns, prompts, runMentions } from "@workspace/lib/db/schema";
import type { RunMentionAssessments } from "@workspace/lib/mentions";
import { createOwnerDb } from "@workspace/lib/test/integration/owner-db";
import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deriveAnswerBusinesses } from "../answer-businesses";
import {
	businessContacts,
	localMentions,
	placeAnchors,
	refUsZctas,
	runLocations,
	samplePoints,
	subjectServiceAreas,
} from "../schema";
import { withSubject } from "../tenancy";
import { loadLocalContexts } from "./context";
import { deriveLocalMentions } from "./derive";

const ORG = "local-mentions-test-org";
const A = "local-mentions-test-a";
const B = "local-mentions-test-b";
const subjects = [A, B];
const RIVAL = "William Parrish Plumbing";
/** The CID on that business's card in the recorded overview. */
const RIVAL_CID = "1414125086472960955";

const owner = createOwnerDb();

const overview = JSON.parse(
	readFileSync(new URL("../answer-businesses/__fixtures__/dataforseo-ai-overview.json", import.meta.url), "utf8"),
);

async function saveRun(subjectId: string): Promise<string> {
	const [prompt] = await owner.select({ id: prompts.id }).from(prompts).where(eq(prompts.brandId, subjectId));
	const [run] = await owner
		.insert(promptRuns)
		.values({
			promptId: prompt.id,
			brandId: subjectId,
			model: "google-ai-overview",
			provider: "dataforseo",
			version: "test",
			webSearchEnabled: true,
			rawOutput: overview,
		})
		.returning({ id: promptRuns.id });
	await owner.insert(runLocations).values({
		runId: run.id,
		subjectId,
		pointId: crypto.randomUUID(),
		requestedLocation: {
			pointId: "p",
			latitude: 35.78,
			longitude: -78.64,
			country: "US",
			timezone: "America/New_York",
		},
		locationMethod: "geo_coordinate",
		fidelityTier: "T1",
	});
	return run.id;
}

const judged = (stamp: string, assessments: RunMentionAssessments) => ({
	brandMentioned: !!assessments.brand?.mentioned,
	competitorsMentioned: Object.entries(assessments.competitors)
		.filter(([, assessment]) => assessment.mentioned)
		.map(([name]) => name),
	assessments,
	stamp,
});

const assessments: RunMentionAssessments = {
	brand: { mentioned: true, probability: 0.88, sentiment: "positive" },
	competitors: { [RIVAL]: { mentioned: true, probability: 0.97, sentiment: "positive" } },
	judged: { brand: "b", competitors: { [RIVAL]: "r" } },
};

const mentionsOf = (runId: string) =>
	owner.select().from(localMentions).where(eq(localMentions.runId, runId)).orderBy(asc(localMentions.competitorName));

const derive = (subjectId: string) => withSubject(subjectId, () => deriveLocalMentions(subjectId, 100));

beforeAll(async () => {
	await cleanUp();
	await owner.insert(organization).values({ id: ORG, name: "Local Mentions Test", slug: ORG, createdAt: new Date() });
	await owner.insert(brands).values([
		{ id: A, name: "Oak City Plumbing", website: "https://oakcity.example", organizationId: ORG },
		{ id: B, name: "Mile High Plumbing", website: "https://milehigh.example", organizationId: ORG },
	]);
	await owner.insert(competitors).values({ brandId: A, name: RIVAL });
	await owner.insert(prompts).values(subjects.map((brandId) => ({ brandId, value: "best plumber near me" })));
});

afterAll(async () => {
	await cleanUp();
	await owner.$client.end();
});

async function cleanUp() {
	await owner.delete(promptRuns).where(inArray(promptRuns.brandId, subjects));
	await owner.delete(prompts).where(inArray(prompts.brandId, subjects));
	await owner.delete(competitors).where(inArray(competitors.brandId, subjects));
	await owner.delete(brands).where(inArray(brands.id, subjects));
	await owner.delete(organization).where(eq(organization.id, ORG));
}

describe("local mentions", () => {
	let run: string;

	beforeAll(async () => {
		run = await saveRun(A);
		await owner.insert(placeAnchors).values({
			subjectId: A,
			competitorName: RIVAL,
			placeId: "ChIJrivalrivalrival01",
			cid: RIVAL_CID,
			searchQuery: RIVAL,
			confirmedBy: "staff",
		});
	});

	it("waits for both the run's cards and its judgement", async () => {
		expect(await derive(A)).toBe(0);
		await withSubject(A, () => deriveAnswerBusinesses([run]));
		expect(await derive(A)).toBe(0);
		await owner.insert(runMentions).values({ runId: run, ...judged("judge-1", assessments) });
		expect(await derive(A)).toBe(1);
	});

	it("matches a competitor by its card and the subject by the judge's reading, flagged until tied to a listing", async () => {
		expect(await mentionsOf(run)).toEqual([
			expect.objectContaining({
				subjectId: A,
				competitorName: RIVAL,
				counted: true,
				method: "cid",
				confidence: 1,
				review: null,
				cardPlacement: "answer",
				cardPosition: 1,
			}),
			expect.objectContaining({
				competitorName: null,
				counted: true,
				method: "text+jev",
				confidence: 0.88,
				review: "unresolved",
				cardPlacement: null,
			}),
		]);
	});

	it("leaves a matched run alone until something it was matched on changes", async () => {
		expect(await derive(A)).toBe(0);

		await owner.insert(businessContacts).values({ subjectId: A, phone: "+19199711803", updatedBy: "staff" });
		expect(await derive(A)).toBe(1);
		expect((await mentionsOf(run)).find((row) => row.competitorName === null)).toMatchObject({
			method: "phone",
			cardPosition: 2,
			review: null,
		});

		const ruledOut: RunMentionAssessments = {
			...assessments,
			competitors: { [RIVAL]: { mentioned: false, probability: 0.1, reason: "other_company" } },
		};
		await owner.update(runMentions).set(judged("judge-2", ruledOut)).where(eq(runMentions.runId, run));
		await owner.delete(businessContacts).where(eq(businessContacts.subjectId, A));
		await owner.delete(placeAnchors).where(eq(placeAnchors.subjectId, A));
		expect(await derive(A)).toBe(1);
		expect(await mentionsOf(run)).toEqual([
			expect.objectContaining({ competitorName: RIVAL, counted: false, method: "text+jev" }),
			expect.objectContaining({ competitorName: null, counted: true, method: "text+jev" }),
		]);
	});

	it("counts another listing of a business's name nearby, placed by the card's ZIP", async () => {
		const area = { subjectId: A, name: "Raleigh", centerLat: 35.7796, centerLng: -78.6382, radiusMeters: 16000 };
		const [raleigh] = await owner
			.insert(subjectServiceAreas)
			.values({ ...area, timezone: "America/New_York" })
			.returning();
		await owner
			.insert(refUsZctas)
			.values({ zcta: "27601", lat: 35.7727, lng: -78.6347, landAreaM2: 2_000_000, vintage: 2025 })
			.onConflictDoNothing();
		await owner.insert(placeAnchors).values({
			subjectId: A,
			competitorName: RIVAL,
			placeId: "ChIJrivalsecondlist01",
			cid: "42",
			searchQuery: RIVAL,
			confirmedBy: "staff",
		});
		const sure = { mentioned: true, probability: 0.97, sentiment: "positive" } as const;
		await owner
			.update(runMentions)
			.set(judged("judge-3", { ...assessments, competitors: { [RIVAL]: sure } }))
			.where(eq(runMentions.runId, run));
		try {
			expect(await derive(A)).toBe(1);
			expect((await mentionsOf(run)).find((row) => row.competitorName === RIVAL)).toMatchObject({
				counted: true,
				method: "text+jev",
				review: "other_listing",
			});
		} finally {
			await owner.delete(placeAnchors).where(eq(placeAnchors.subjectId, A));
			await owner.delete(subjectServiceAreas).where(eq(subjectServiceAreas.id, raleigh.id));
			await owner.delete(refUsZctas).where(eq(refUsZctas.zcta, "27601"));
		}
	});

	it("matches only the subject's own runs", async () => {
		const other = await saveRun(B);
		await withSubject(B, () => deriveAnswerBusinesses([other]));
		await owner
			.insert(runMentions)
			.values({ runId: other, ...judged("judge-1", { competitors: {}, judged: { brand: "b", competitors: {} } }) });
		expect(await derive(B)).toBe(1);
		expect(await mentionsOf(other)).toEqual([]);
		expect(await mentionsOf(run)).toHaveLength(2);
	});
});

describe("where the judge is told a local business is", () => {
	beforeAll(async () => {
		const [area] = await owner
			.insert(subjectServiceAreas)
			.values({
				subjectId: A,
				name: "Raleigh",
				centerLat: 35.7796,
				centerLng: -78.6382,
				radiusMeters: 16000,
				timezone: "America/New_York",
				isPrimary: true,
			})
			.returning();
		const point = {
			subjectId: A,
			areaId: area.id,
			kind: "centroid" as const,
			country: "US",
			timezone: "America/New_York",
		};
		await owner.insert(samplePoints).values([
			{ ...point, label: "Cary", lat: 35.7915, lng: -78.7811, city: "Cary", region: "NC" },
			{ ...point, label: "Raleigh", lat: 35.7796, lng: -78.6382, city: "Raleigh", region: "NC" },
		]);
		await owner.insert(businessContacts).values([
			{ subjectId: A, address: "1 Fayetteville St, Raleigh, NC", phone: "+19195550100", updatedBy: "staff" },
			{ subjectId: A, competitorName: RIVAL, phone: "+19193430783", updatedBy: "staff" },
		]);
	});

	it("names the subject's areas, nearest cities first, with its address and phone", async () => {
		const contexts = await withSubject(A, () => loadLocalContexts(db, [A, B]));
		expect(contexts.get(A)?.subject).toBe(
			"It's the business of that name serving Raleigh (Raleigh, NC; Cary, NC), at 1 Fayetteville St, Raleigh, NC, phone (919) 555-0100.",
		);
		expect(contexts.get(A)?.competitors.get(RIVAL.toLowerCase())).toBe(
			"It's the business of that name serving Raleigh (Raleigh, NC; Cary, NC), phone (919) 343-0783.",
		);
	});

	it("gives a subject with no service area none, so it's judged as before", async () => {
		const contexts = await loadLocalContexts(db, [B]);
		expect(contexts.has(B)).toBe(false);
	});
});
