import { readFileSync } from "node:fs";
import { db } from "@workspace/lib/db/db";
import { brands, organization, promptRuns, prompts } from "@workspace/lib/db/schema";
import { createOwnerDb } from "@workspace/lib/test/integration/owner-db";
import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { answerBusinesses, runLocations } from "../schema";
import { withSubject } from "../tenancy";
import { deriveAnswerBusinesses, staleBusinessRuns } from "./derive";
import { ANSWER_BUSINESSES_VERSION } from "./parse";

const ORG = "answer-businesses-test-org";
const A = "answer-businesses-test-a";
const B = "answer-businesses-test-b";
const subjects = [A, B];

const owner = createOwnerDb();

function fixture(name: string): unknown {
	return JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), "utf8"));
}

async function saveRun(
	subjectId: string,
	provider: string,
	rawOutput: unknown,
	{ located = true } = {},
): Promise<string> {
	const [prompt] = await owner.select({ id: prompts.id }).from(prompts).where(eq(prompts.brandId, subjectId));
	const [run] = await owner
		.insert(promptRuns)
		.values({
			promptId: prompt.id,
			brandId: subjectId,
			model: "google-ai-mode",
			provider,
			version: "test",
			webSearchEnabled: true,
			rawOutput,
		})
		.returning({ id: promptRuns.id });
	if (located) {
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
	}
	return run.id;
}

const cardsOf = (runId: string) =>
	owner
		.select()
		.from(answerBusinesses)
		.where(eq(answerBusinesses.runId, runId))
		.orderBy(asc(answerBusinesses.placement), asc(answerBusinesses.position));

const versionOf = async (runId: string) =>
	(await owner.select().from(runLocations).where(eq(runLocations.runId, runId)))[0]?.businessesVersion;

beforeAll(async () => {
	await cleanUp();
	await owner.insert(organization).values({ id: ORG, name: "Cards Test", slug: ORG, createdAt: new Date() });
	await owner
		.insert(brands)
		.values(subjects.map((id) => ({ id, name: id, website: `https://${id}.example`, organizationId: ORG })));
	await owner.insert(prompts).values(subjects.map((brandId) => ({ brandId, value: "plumber near me" })));
});

afterAll(async () => {
	await cleanUp();
	await owner.$client.end();
});

async function cleanUp() {
	await owner.delete(promptRuns).where(inArray(promptRuns.brandId, subjects));
	await owner.delete(prompts).where(inArray(prompts.brandId, subjects));
	await owner.delete(brands).where(inArray(brands.id, subjects));
	await owner.delete(organization).where(eq(organization.id, ORG));
}

describe("answer businesses", () => {
	let overview: string;
	let claude: string;

	beforeAll(async () => {
		overview = await saveRun(A, "dataforseo", fixture("dataforseo-ai-overview"));
		claude = await saveRun(A, "anthropic-api", { content: [{ type: "text", text: "Try Acme Plumbing." }] });
	});

	it("lists located runs whose cards haven't been derived", async () => {
		const stale = await withSubject(A, () => staleBusinessRuns(100));
		expect(stale.get(A)).toEqual(expect.arrayContaining([overview, claude]));
	});

	it("stores each run's cards with their placement and position, and stamps every run read", async () => {
		const result = await withSubject(A, () => deriveAnswerBusinesses([overview, claude]));
		expect(result).toEqual({ derived: 2, failed: [] });

		const cards = await cardsOf(overview);
		expect(cards.map((card) => [card.placement, card.position])).toEqual([
			["answer", 1],
			["answer", 2],
			["answer", 3],
			["answer", 4],
			["answer", 5],
			["local_pack", 1],
			["local_pack", 2],
			["local_pack", 3],
		]);
		expect(cards[0]).toMatchObject({
			subjectId: A,
			name: "William Parrish Plumbing",
			cid: "1414125086472960955",
			phone: "+19193430783",
			rating: 4.9,
		});
		expect(await cardsOf(claude)).toEqual([]);
		expect(await versionOf(overview)).toBe(ANSWER_BUSINESSES_VERSION);
		expect(await versionOf(claude)).toBe(ANSWER_BUSINESSES_VERSION);
		expect((await withSubject(A, () => staleBusinessRuns(100))).get(A) ?? []).not.toContain(overview);
	});

	it("replaces a run's cards when they're derived again", async () => {
		await owner.update(runLocations).set({ businessesVersion: null }).where(eq(runLocations.runId, overview));
		expect((await withSubject(A, () => staleBusinessRuns(100))).get(A)).toContain(overview);
		await withSubject(A, () => deriveAnswerBusinesses([overview]));
		expect(await cardsOf(overview)).toHaveLength(8);
	});

	it("leaves runs with no location alone", async () => {
		const brandMode = await saveRun(A, "dataforseo", fixture("dataforseo-ai-mode"), { located: false });
		expect(await withSubject(A, () => deriveAnswerBusinesses([brandMode]))).toEqual({ derived: 0, failed: [] });
		expect(await cardsOf(brandMode)).toEqual([]);
	});

	it("can't read or write another subject's runs", async () => {
		const theirs = await saveRun(B, "dataforseo", fixture("dataforseo-ai-mode"));
		expect(await withSubject(A, () => deriveAnswerBusinesses([theirs]))).toEqual({ derived: 0, failed: [] });
		expect(await cardsOf(theirs)).toEqual([]);
		expect((await withSubject(A, () => staleBusinessRuns(100))).has(B)).toBe(false);
		expect(await withSubject(B, () => db.select().from(answerBusinesses))).toEqual([]);
	});
});
