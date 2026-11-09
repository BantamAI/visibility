import { describe, expect, it } from "vitest";
import { distanceCanary, nameMatchesPlace, pointOverlapByDistance, repeatOverlap, type ScoredAnswer } from "./scoring";

const raleigh = { latitude: 35.7796, longitude: -78.6382 };
const cary = { latitude: 35.7915, longitude: -78.7811 };
const charlotte = { latitude: 35.2271, longitude: -80.8431 };

describe("distanceCanary", () => {
	it("passes when most named businesses are near the point", () => {
		const businesses = [
			{ name: "A", ...raleigh },
			{ name: "B", ...cary },
			{ name: "C", ...charlotte },
		];
		expect(distanceCanary(raleigh, businesses, 10)).toBe("pass");
	});

	it("fails when the businesses are in another metro", () => {
		const businesses = [
			{ name: "A", ...charlotte },
			{ name: "B", ...charlotte },
		];
		expect(distanceCanary(raleigh, businesses, 10)).toBe("fail");
	});

	it("can't judge an answer whose businesses couldn't be placed", () => {
		expect(distanceCanary(raleigh, [{ name: "Unplaced Plumbing" }], 10)).toBe("no-businesses");
	});
});

describe("nameMatchesPlace", () => {
	it("matches a listing that shares the distinctive words", () => {
		expect(nameMatchesPlace("William Parrish Plumbing", "William Parrish Plumbing LLC")).toBe(true);
	});

	it("rejects the map's nearest guess for a different business", () => {
		expect(nameMatchesPlace("Westover Plumbing", "Poseidon Plumbing LLC")).toBe(false);
	});
});

function answer(point: string, rep: number, names: string[]): ScoredAnswer {
	return {
		route: "r",
		phase: "main",
		subject: "raleigh",
		point,
		promptId: "N1",
		rep,
		businesses: names.map((name) => ({ name })),
	};
}

describe("point sensitivity", () => {
	const points: Record<string, { latitude: number; longitude: number }> = { a: raleigh, b: cary };

	it("shows a route that ignores the point overlapping across points as much as across repeats", () => {
		const answers = [
			answer("a", 1, ["X", "Y"]),
			answer("a", 2, ["X", "Y"]),
			answer("b", 1, ["X", "Y"]),
			answer("b", 2, ["X", "Y"]),
		];
		expect(repeatOverlap(answers)).toBe(1);
		expect(
			pointOverlapByDistance(
				answers,
				(id) => points[id],
				() => 0,
			).get(0),
		).toBe(1);
	});

	it("shows a route that uses the point overlapping less across points", () => {
		const answers = [
			answer("a", 1, ["X", "Y"]),
			answer("a", 2, ["X", "Y"]),
			answer("b", 1, ["Z", "W"]),
			answer("b", 2, ["Z", "W"]),
		];
		expect(repeatOverlap(answers)).toBe(1);
		expect(
			pointOverlapByDistance(
				answers,
				(id) => points[id],
				() => 0,
			).get(0),
		).toBe(0);
	});
});
