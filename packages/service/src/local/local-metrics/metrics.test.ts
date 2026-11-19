import { describe, expect, it } from "vitest";
import { wilsonInterval } from "./interval";
import {
	averagePosition,
	computeLocalMetrics,
	type MetricRun,
	mentionRates,
	mentionTrend,
	phrasingOf,
	sentimentBreakdown,
	shareOfVoice,
} from "./metrics";

let id = 0;
const run = (overrides: Partial<MetricRun> = {}): MetricRun => ({
	runId: `run-${++id}`,
	model: "chatgpt",
	areaId: "raleigh",
	phrasing: "near-me",
	tier: "T1",
	createdAt: new Date("2026-11-10T12:00:00Z"),
	subject: null,
	competitors: [],
	...overrides,
});
const named = (position: number | null = null, extra: Partial<NonNullable<MetricRun["subject"]>> = {}) => ({
	position,
	positionFrom: position === null ? null : ("text" as const),
	sentiment: null,
	...extra,
});

describe("wilsonInterval", () => {
	it("matches the published interval for 8 of 10", () => {
		const { rate, low, high } = wilsonInterval(8, 10);
		expect(rate).toBe(0.8);
		expect(low).toBeCloseTo(0.4902, 3);
		expect(high).toBeCloseTo(0.9433, 3);
	});

	it("stays inside 0 and 1 at the extremes", () => {
		expect(wilsonInterval(0, 5)).toMatchObject({ rate: 0, low: 0 });
		expect(wilsonInterval(0, 5).high).toBeCloseTo(0.4345, 3);
		expect(wilsonInterval(5, 5)).toMatchObject({ rate: 1, high: 1 });
		expect(wilsonInterval(5, 5).low).toBeCloseTo(0.5655, 3);
	});

	it("narrows as answers accumulate", () => {
		const few = wilsonInterval(3, 10);
		const many = wilsonInterval(300, 1000);
		expect((many.high ?? 0) - (many.low ?? 0)).toBeLessThan((few.high ?? 0) - (few.low ?? 0));
	});

	it("has no rate without answers", () => {
		expect(wilsonInterval(0, 0)).toEqual({ successes: 0, trials: 0, rate: null, low: null, high: null });
	});
});

describe("phrasingOf", () => {
	it("reads the template tags", () => {
		expect(phrasingOf(["service:plumber", "near-me"])).toBe("near-me");
		expect(phrasingOf(["city-named", "city:cary-nc"])).toBe("city-named");
		expect(phrasingOf(["custom"])).toBe("other");
	});
});

describe("mentionRates", () => {
	it("gives each engine its own rate and interval", () => {
		const rows = mentionRates(
			[
				run({ model: "chatgpt", subject: named() }),
				run({ model: "chatgpt" }),
				run({ model: "chatgpt", subject: named() }),
				run({ model: "gemini" }),
			],
			(r) => r.model,
		);
		expect(rows.map(({ key, successes, trials }) => ({ key, successes, trials }))).toEqual([
			{ key: "chatgpt", successes: 2, trials: 3 },
			{ key: "gemini", successes: 0, trials: 1 },
		]);
		expect(rows[0]?.low).toBeGreaterThan(0);
		expect(rows[0]?.high).toBeLessThan(1);
	});
});

describe("shareOfVoice", () => {
	it("counts the subject against the area's tracked competitors, once per answer", () => {
		const sov = shareOfVoice([
			run({ subject: named(), competitors: ["Triangle Rooter"] }),
			run({ competitors: ["Triangle Rooter", "Capital Drains", "Triangle Rooter"] }),
			run(),
		]);
		expect(sov).toEqual({
			subjectMentions: 1,
			totalMentions: 4,
			share: 0.25,
			competitors: [
				{ name: "Triangle Rooter", mentions: 2, share: 0.5 },
				{ name: "Capital Drains", mentions: 1, share: 0.25 },
			],
		});
	});

	it("has no share when no one is named", () => {
		expect(shareOfVoice([run()]).share).toBeNull();
	});
});

describe("averagePosition", () => {
	it("averages card and text positions over the answers that rank the subject", () => {
		expect(
			averagePosition([
				run({ subject: named(1, { positionFrom: "card" }) }),
				run({ subject: named(4) }),
				run({ subject: named(null) }),
				run(),
			]),
		).toEqual({ average: 2.5, ranked: 2, byCard: 1 });
	});
});

describe("sentimentBreakdown", () => {
	it("counts the judge's sentiment over the answers naming the subject", () => {
		const breakdown = sentimentBreakdown([
			run({ subject: named(null, { sentiment: "positive" }) }),
			run({ subject: named(null, { sentiment: "positive" }) }),
			run({ subject: named(null, { sentiment: "negative" }) }),
			run({ subject: named() }),
			run(),
		]);
		expect(breakdown).toMatchObject({
			mentions: 4,
			judged: 3,
			counts: { positive: 2, neutral: 0, negative: 1, mixed: 0 },
			positive: { successes: 2, trials: 3 },
		});
	});
});

describe("mentionTrend", () => {
	const since = new Date("2026-10-26T00:00:00Z");
	const until = new Date("2026-11-16T00:00:00Z");
	const week1 = new Date("2026-10-27T12:00:00Z");
	const week2 = new Date("2026-11-03T12:00:00Z");
	const week3 = new Date("2026-11-12T12:00:00Z");

	it("buckets answers by week, keeping empty weeks", () => {
		const trend = mentionTrend([run({ createdAt: week1, subject: named() }), run({ createdAt: week3 })], since, until);
		expect(trend.map((point) => [point.weekStart.toISOString(), point.successes, point.trials])).toEqual([
			["2026-10-26T00:00:00.000Z", 1, 1],
			["2026-11-02T00:00:00.000Z", 0, 0],
			["2026-11-09T00:00:00.000Z", 0, 1],
		]);
		expect(trend[1]?.rate).toBeNull();
	});

	it("marks a week whose tier mix moves from the last week with answers", () => {
		const trend = mentionTrend(
			[
				run({ createdAt: week1, tier: "T1" }),
				run({ createdAt: week1, tier: "T1" }),
				run({ createdAt: week2, tier: "T1" }),
				run({ createdAt: week2, tier: "T1" }),
				run({ createdAt: week3, tier: "T1" }),
				run({ createdAt: week3, tier: "T4" }),
			],
			since,
			until,
		);
		expect(trend.map((point) => point.tierMixChanged)).toEqual([false, false, true]);
		expect(trend[2]?.tiers).toMatchObject({ T1: 1, T4: 1 });
	});

	it("doesn't mark a small drift in the mix", () => {
		const trend = mentionTrend(
			[
				...Array.from({ length: 10 }, () => run({ createdAt: week1, tier: "T1" })),
				...Array.from({ length: 9 }, () => run({ createdAt: week2, tier: "T1" })),
				run({ createdAt: week2, tier: "T4" }),
			],
			since,
			until,
		);
		expect(trend.some((point) => point.tierMixChanged)).toBe(false);
	});
});

describe("computeLocalMetrics", () => {
	it("reports each metric separately, with no blended score", () => {
		const metrics = computeLocalMetrics(
			[run({ subject: named(2, { sentiment: "positive" }), competitors: ["Triangle Rooter"] }), run({ tier: "T4" })],
			new Date("2026-11-09T00:00:00Z"),
			new Date("2026-11-16T00:00:00Z"),
		);
		expect(Object.keys(metrics).sort()).toEqual([
			"byArea",
			"byEngine",
			"byPhrasing",
			"mentionRate",
			"position",
			"sentiment",
			"shareOfVoice",
			"tiers",
			"trend",
		]);
		expect(metrics.mentionRate).toMatchObject({ successes: 1, trials: 2 });
		expect(metrics.tiers).toEqual({ T1: 1, T2: 0, T3: 0, T4: 1, T5: 0 });
	});
});
