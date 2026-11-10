import { describe, expect, it } from "vitest";
import type { MatchableCard } from "./match";
import { nearAreaByZip, zipOf } from "./near";

const raleigh = { lat: 35.7796, lng: -78.6382, radiusMeters: 16093 };
const zips = new Map([
	["27502", { lat: 35.7225, lng: -78.8578 }],
	["28202", { lat: 35.2276, lng: -80.8433 }],
]);
const card = (address: string | null) => ({ address }) as MatchableCard;

describe("placing a card near the subject's areas", () => {
	it("reads the ZIP after the state, not a street number", () => {
		expect(zipOf("12601 E 38th Ave, Denver, CO 80239")).toBe("80239");
		expect(zipOf("1 Main St, Cary, NC 27511-4421, USA")).toBe("27511");
		expect(zipOf("Downtown")).toBeNull();
	});

	it("counts a business just past the edge as near, and one across the state as not", () => {
		const near = nearAreaByZip([raleigh], zips);
		expect(near(card("1 Salem St, Apex, NC 27502"))).toBe(true);
		expect(near(card("1 Trade St, Charlotte, NC 28202"))).toBe(false);
	});

	it("can't place a card without a known ZIP", () => {
		const near = nearAreaByZip([raleigh], zips);
		expect(near(card(null))).toBeNull();
		expect(near(card("1 Main St, Boise, ID 83702"))).toBeNull();
	});
});
