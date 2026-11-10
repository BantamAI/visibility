import { describe, expect, it } from "vitest";
import { type AreaCandidate, trackedInArea } from "./rank";

const candidate = (placeId: string, fields: Partial<AreaCandidate> = {}): AreaCandidate => ({
	placeId,
	name: placeId,
	status: "auto",
	seedRank: null,
	answerRuns: 0,
	serviceRuns: 0,
	tracked: false,
	...fields,
});

const settings = { minRuns: 3, perArea: 2, windowDays: 90 };

describe("trackedInArea", () => {
	it("tracks a business named in enough runs of one service, and not one named in fewer", () => {
		const tracked = trackedInArea(
			[
				candidate("recurs", { answerRuns: 3, serviceRuns: 3 }),
				candidate("spread", { answerRuns: 4, serviceRuns: 2 }),
				candidate("once", { answerRuns: 1, serviceRuns: 1 }),
			],
			settings,
		);
		expect([...tracked]).toEqual(["recurs"]);
	});

	it("tracks seeded businesses before any runs, in Google's order, up to the area's limit", () => {
		const tracked = trackedInArea(
			[candidate("third", { seedRank: 3 }), candidate("first", { seedRank: 1 }), candidate("second", { seedRank: 2 })],
			settings,
		);
		expect([...tracked]).toEqual(["first", "second"]);
	});

	it("puts businesses answers name ahead of Google's listings once runs come in", () => {
		const tracked = trackedInArea(
			[
				candidate("listed", { seedRank: 1 }),
				candidate("named", { answerRuns: 5, serviceRuns: 5 }),
				candidate("both", { seedRank: 2, answerRuns: 2, serviceRuns: 2 }),
			],
			settings,
		);
		expect([...tracked]).toEqual(["named", "both"]);
	});

	it("always tracks a pinned business, outside the limit, and never an ignored one", () => {
		const tracked = trackedInArea(
			[
				candidate("pinned", { status: "pinned" }),
				candidate("ignored", { status: "ignored", answerRuns: 9, serviceRuns: 9 }),
				candidate("a", { answerRuns: 5, serviceRuns: 5 }),
				candidate("b", { answerRuns: 4, serviceRuns: 4 }),
			],
			settings,
		);
		expect([...tracked].sort()).toEqual(["a", "b", "pinned"]);
	});

	it("keeps a tracked business over an untracked one named as often", () => {
		const tracked = trackedInArea(
			[
				candidate("a-newcomer", { answerRuns: 4, serviceRuns: 4 }),
				candidate("b-incumbent", { answerRuns: 4, serviceRuns: 4, tracked: true }),
				candidate("c-leader", { answerRuns: 6, serviceRuns: 6 }),
			],
			settings,
		);
		expect([...tracked]).toEqual(["c-leader", "b-incumbent"]);
	});
});
