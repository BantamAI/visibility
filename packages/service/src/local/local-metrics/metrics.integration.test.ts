import { brands, organization, promptRuns, prompts, runMentions } from "@workspace/lib/db/schema";
import type { RunMentionAssessments } from "@workspace/lib/mentions";
import type { FidelityTier } from "@workspace/lib/providers";
import { createOwnerDb } from "@workspace/lib/test/integration/owner-db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	areaCompetitors,
	gridScanRuns,
	gridScans,
	localMentions,
	runLocations,
	samplePoints,
	subjectServiceAreas,
} from "../schema";
import { withSubject } from "../tenancy";
import { listHeatMapScans, scanHeatMap } from "./heat-map";
import { localMetrics } from "./load";

const ORG = "local-metrics-test-org";
const S = "local-metrics-test-s";
const OTHER = "local-metrics-test-other";
const NOW = new Date("2026-11-10T12:00:00Z");
const WINDOW = { since: new Date("2026-11-09T00:00:00Z"), until: new Date("2026-11-16T00:00:00Z") };
const TIER_METHOD = { T1: "geo_coordinate", T2: "egress_city", T3: "egress_region", T4: "api_user_location" } as const;

const owner = createOwnerDb();

let raleigh: { areaId: string; points: string[] };
let durham: { areaId: string; points: string[] };
let nearMePrompt: string;
let cityPrompt: string;

async function addArea(subjectId: string, name: string, lat: number, lng: number) {
	const [area] = await owner
		.insert(subjectServiceAreas)
		.values({
			subjectId,
			name,
			centerLat: lat,
			centerLng: lng,
			radiusMeters: 12000,
			isPrimary: name === "Raleigh",
			timezone: "America/New_York",
		})
		.returning();
	const points = await owner
		.insert(samplePoints)
		.values(
			[0, 1, 2].map((i) => ({
				subjectId,
				areaId: area.id,
				kind: "grid" as const,
				label: `${name} ${i}`,
				lat: lat + i * 0.05,
				lng,
				country: "US",
				timezone: "America/New_York",
			})),
		)
		.returning();
	return { areaId: area.id, points: points.map((point) => point.id) };
}

interface Answer {
	pointId: string;
	model?: string;
	prompt?: string;
	tier?: keyof typeof TIER_METHOD;
	at?: Date;
	matched?: boolean;
	/** Null for the subject. */
	counted?: (string | null)[];
	notCounted?: (string | null)[];
	card?: number;
	judged?: { position?: number; sentiment?: "positive" | "negative" };
	subjectId?: string;
}

async function answer(opts: Answer): Promise<string> {
	const subjectId = opts.subjectId ?? S;
	const tier = opts.tier ?? "T1";
	const [run] = await owner
		.insert(promptRuns)
		.values({
			promptId: opts.prompt ?? nearMePrompt,
			brandId: subjectId,
			model: opts.model ?? "chatgpt",
			provider: "test",
			version: "test",
			webSearchEnabled: true,
			rawOutput: {},
			createdAt: opts.at ?? NOW,
		})
		.returning({ id: promptRuns.id });
	await owner.insert(runLocations).values({
		runId: run.id,
		subjectId,
		pointId: opts.pointId,
		requestedLocation: { pointId: opts.pointId, latitude: 0, longitude: 0, country: "US", timezone: "UTC" },
		locationMethod: TIER_METHOD[tier],
		fidelityTier: tier,
		localMentionsStamp: opts.matched === false ? null : "test",
	});
	const rows = [
		...(opts.counted ?? []).map((name) => ({ name, counted: true })),
		...(opts.notCounted ?? []).map((name) => ({ name, counted: false })),
	];
	for (const { name, counted } of rows)
		await owner.insert(localMentions).values({
			runId: run.id,
			subjectId,
			competitorName: name,
			counted,
			method: name === null && opts.card ? "place_id" : "text+jev",
			confidence: counted ? 0.95 : 0.4,
			cardPlacement: name === null && opts.card ? "answer" : null,
			cardPosition: name === null && opts.card ? opts.card : null,
		});
	if (opts.judged) {
		const assessments: RunMentionAssessments = {
			brand: { mentioned: true, probability: 0.95, ...opts.judged },
			competitors: {},
			judged: { brand: "x", competitors: {} },
		};
		await owner.insert(runMentions).values({ runId: run.id, brandMentioned: true, assessments });
	}
	return run.id;
}

const metrics = (scope: { areaId?: string; model?: string; tiers?: FidelityTier[] } = {}, subjectId = S) =>
	withSubject(subjectId, () => localMetrics(subjectId, { ...WINDOW, ...scope }));

async function cleanUp() {
	for (const id of [S, OTHER]) await owner.delete(promptRuns).where(eq(promptRuns.brandId, id));
	for (const id of [S, OTHER]) {
		await owner.delete(prompts).where(eq(prompts.brandId, id));
		await owner.delete(brands).where(eq(brands.id, id));
	}
	await owner.delete(organization).where(eq(organization.id, ORG));
}

beforeAll(async () => {
	await cleanUp();
	await owner.insert(organization).values({ id: ORG, name: "Metrics Test", slug: ORG, createdAt: new Date() });
	await owner.insert(brands).values([
		{ id: S, name: "Oak City Plumbing", website: "https://oakcity.example", organizationId: ORG },
		{ id: OTHER, name: "Other Plumbing", website: "https://other.example", organizationId: ORG },
	]);
	const [nearMe, city, other] = await owner
		.insert(prompts)
		.values([
			{ brandId: S, value: "best plumber near me", tags: ["near-me"] },
			{ brandId: S, value: "best plumber in Cary, NC", tags: ["city-named", "city:cary-nc"] },
			{ brandId: OTHER, value: "best plumber near me", tags: ["near-me"] },
		])
		.returning();
	nearMePrompt = nearMe.id;
	cityPrompt = city.id;
	raleigh = await addArea(S, "Raleigh", 35.7796, -78.6382);
	durham = await addArea(S, "Durham", 35.994, -78.8986);
	const otherArea = await addArea(OTHER, "Raleigh", 35.7796, -78.6382);
	await owner.insert(areaCompetitors).values([
		{ subjectId: S, areaId: raleigh.areaId, placeId: "ChIJ-tr", name: "Triangle Rooter", tracked: true },
		{ subjectId: S, areaId: durham.areaId, placeId: "ChIJ-bc", name: "Bull City Drains", tracked: true },
	]);

	const [r0, r1, r2] = raleigh.points as [string, string, string];
	// Raleigh, ChatGPT, T1: named by card at 2, by text at 3, not named, a namesake.
	await answer({ pointId: r0, counted: [null], card: 2, judged: { position: 1, sentiment: "positive" } });
	await answer({ pointId: r1, counted: [null, "Triangle Rooter"], judged: { position: 3, sentiment: "negative" } });
	await answer({ pointId: r2, counted: ["Triangle Rooter", "Bull City Drains"] });
	await answer({ pointId: r2, notCounted: [null] });
	// Not matched yet, so not counted either way.
	await answer({ pointId: r2, matched: false });
	// Gemini at T4, city-named.
	await answer({ pointId: r0, model: "gemini", tier: "T4", prompt: cityPrompt, counted: [null] });
	// Durham.
	await answer({ pointId: durham.points[0] as string, counted: ["Bull City Drains"] });
	// Outside the window.
	await answer({ pointId: r0, at: new Date("2026-10-01T12:00:00Z"), counted: [null] });
	// Another subject's run.
	await answer({ pointId: otherArea.points[0] as string, subjectId: OTHER, prompt: other.id, counted: [null] });
});

afterAll(async () => {
	await cleanUp();
	await owner.$client.end();
});

describe("localMetrics", () => {
	it("rates the matched answers in the window, with an interval", async () => {
		const result = await metrics();
		expect(result.mentionRate).toMatchObject({ successes: 3, trials: 6 });
		expect(result.mentionRate.low).toBeGreaterThan(0.1);
		expect(result.mentionRate.high).toBeLessThan(0.9);
	});

	it("breaks the rate down by engine, area and phrasing", async () => {
		const result = await metrics();
		const pick = (rows: { key: string; successes: number; trials: number }[]) =>
			Object.fromEntries(rows.map(({ key, successes, trials }) => [key, [successes, trials]]));
		expect(pick(result.byEngine)).toEqual({ chatgpt: [2, 5], gemini: [1, 1] });
		expect(pick(result.byArea)).toEqual({ [raleigh.areaId]: [3, 5], [durham.areaId]: [0, 1] });
		expect(pick(result.byPhrasing)).toEqual({ "near-me": [2, 5], "city-named": [1, 1] });
	});

	it("counts only competitors tracked in each answer's area toward share of voice", async () => {
		const { shareOfVoice } = await metrics();
		expect(shareOfVoice.subjectMentions).toBe(3);
		expect(shareOfVoice.competitors).toEqual([
			{ name: "Triangle Rooter", mentions: 2, share: 2 / 6 },
			{ name: "Bull City Drains", mentions: 1, share: 1 / 6 },
		]);
	});

	it("takes a card's position over the judge's, and the judge's sentiment", async () => {
		const result = await metrics();
		expect(result.position).toEqual({ average: 2.5, ranked: 2, byCard: 1 });
		expect(result.sentiment).toMatchObject({ mentions: 3, judged: 2, counts: { positive: 1, negative: 1 } });
	});

	it("filters every metric by tier", async () => {
		const result = await metrics({ tiers: ["T1", "T2"] });
		expect(result.mentionRate).toMatchObject({ successes: 2, trials: 5 });
		expect(result.byEngine.map((row) => row.key)).toEqual(["chatgpt"]);
		expect(result.tiers).toMatchObject({ T1: 5, T4: 0 });
		expect((await metrics({ tiers: [] })).mentionRate.trials).toBe(0);
	});

	it("narrows to an area and engine", async () => {
		expect((await metrics({ areaId: durham.areaId })).mentionRate).toMatchObject({ successes: 0, trials: 1 });
		expect((await metrics({ model: "gemini" })).mentionRate).toMatchObject({ successes: 1, trials: 1 });
	});

	it("sees only the subject in scope", async () => {
		expect((await metrics({}, OTHER)).mentionRate).toMatchObject({ successes: 1, trials: 1 });
		await expect(withSubject(OTHER, () => localMetrics(S, WINDOW))).resolves.toMatchObject({
			mentionRate: { trials: 0 },
		});
	});
});

describe("heat maps", () => {
	let scanId: string;

	beforeAll(async () => {
		const [r0, r1, r2] = raleigh.points as [string, string, string];
		const scan = async (tier: FidelityTier, createdAt: Date, model = "google-ai-mode") => {
			const [row] = await owner
				.insert(gridScans)
				.values({
					subjectId: S,
					areaId: raleigh.areaId,
					promptId: nearMePrompt,
					model,
					provider: "test",
					webSearchEnabled: true,
					fidelityTier: tier,
					pointKind: "grid",
					repeats: 2,
					pointsPlanned: 4,
					createdAt,
					uncovered: [
						{ pointId: "00000000-0000-4000-8000-000000000001", label: "Lake", lat: 35.9, lng: -78.7, reason: "water", standInPointId: null },
						{ pointId: "00000000-0000-4000-8000-000000000002", label: "Edge", lat: 35.95, lng: -78.7, reason: "no city", standInPointId: r0 },
					],
				})
				.returning();
			return row.id;
		};
		await scan("T1", new Date("2026-11-09T12:00:00Z"));
		scanId = await scan("T1", new Date("2026-11-11T12:00:00Z"));
		await scan("T4", new Date("2026-11-12T12:00:00Z"), "claude");

		const scanRun = async (pointId: string, repeat: number, run: Omit<Answer, "pointId"> | "failed" | "pending") => {
			const location = { pointId, latitude: 35.7, longitude: -78.6, country: "US", timezone: "UTC" };
			if (typeof run === "string") {
				await owner.insert(gridScanRuns).values({ subjectId: S, scanId, pointId, location, repeat, status: run });
				return;
			}
			const runId = await answer({ pointId, model: "google-ai-mode", ...run });
			await owner
				.insert(gridScanRuns)
				.values({ subjectId: S, scanId, pointId, location, repeat, status: "answered", runId });
		};
		await scanRun(r0, 1, { counted: [null], card: 1 });
		await scanRun(r0, 2, { counted: [null], judged: { position: 3 } });
		await scanRun(r1, 1, { counted: ["Triangle Rooter"] });
		await scanRun(r1, 2, "failed");
		await scanRun(r2, 1, { counted: [null], matched: false });
		await scanRun(r2, 2, "pending");
	});

	it("lists the latest T1 and T2 scan of each prompt and engine", async () => {
		const scans = await withSubject(S, () => listHeatMapScans(S, { ...WINDOW, areaId: raleigh.areaId }));
		expect(scans.map((scan) => [scan.id, scan.fidelityTier, scan.prompt])).toEqual([
			[scanId, "T1", "best plumber near me"],
		]);
		expect(await withSubject(S, () => listHeatMapScans(S, { ...WINDOW, tiers: ["T4"] }))).toEqual([]);
	});

	it("rates each point over its matched answers", async () => {
		const result = await withSubject(S, () => scanHeatMap(scanId));
		const byLabel = Object.fromEntries((result?.points ?? []).map((point) => [point.label, point]));
		expect(byLabel["Raleigh 0"]).toMatchObject({ mentions: { successes: 2, trials: 2 }, averagePosition: 2 });
		expect(byLabel["Raleigh 1"]).toMatchObject({ mentions: { successes: 0, trials: 1 }, failed: 1, averagePosition: null });
		expect(byLabel["Raleigh 2"]).toMatchObject({ mentions: { trials: 0 }, pending: 2 });
		expect(byLabel.Edge).toMatchObject({ standIn: true, gap: false, mentions: { successes: 2, trials: 2 } });
		expect(byLabel.Lake).toMatchObject({ gap: true, mentions: { trials: 0 } });
	});

	it("can't read another subject's scan", async () => {
		expect(await withSubject(OTHER, () => scanHeatMap(scanId))).toBeNull();
	});
});
