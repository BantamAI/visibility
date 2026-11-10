import { describe, expect, it } from "vitest";
import type { PlaceCandidate } from "../../providers/places";
import { pickCandidate } from "./resolve";

const raleigh = [{ lat: 35.7796, lng: -78.6382, radiusMeters: 16_093 }];
const inRaleigh = { lat: 35.79, lng: -78.65 };
const outsideRaleigh = { lat: 35.62, lng: -78.6 };
const inDenver = { lat: 39.7392, lng: -104.9903 };

function candidate(name: string, at: { lat: number; lng: number } | null, fields: Partial<PlaceCandidate> = {}) {
	return {
		placeId: `ChIJ${name.replace(/\W/g, "")}${at?.lat ?? 0}`,
		cid: null,
		name,
		phone: null,
		address: null,
		lat: at?.lat ?? null,
		lng: at?.lng ?? null,
		primaryType: "plumber",
		types: ["plumber"],
		mapsUrl: null,
		website: null,
		...fields,
	} satisfies PlaceCandidate;
}

describe("picking the listing a name refers to", () => {
	it("takes a listing of that name near the areas", () => {
		const near = candidate("Roto-Rooter Plumbing & Water Cleanup", inRaleigh, { cid: "42" });
		const result = pickCandidate("Roto-Rooter", null, [candidate("Roto-Rooter", inDenver), near], raleigh);
		expect(result).toEqual({ resolution: "matched", placeId: near.placeId, cid: "42" });
	});

	it("prefers the exact name to a longer one, then Google's order", () => {
		const longer = candidate("Oak City Plumbing of Garner", inRaleigh);
		const exact = candidate("Oak City Plumbing", inRaleigh);
		expect(pickCandidate("Oak City Plumbing", null, [longer, exact], raleigh).placeId).toBe(exact.placeId);
	});

	it("counts a listing just outside an area as near it", () => {
		const nearby = candidate("Fuquay Drains", outsideRaleigh);
		expect(pickCandidate("Fuquay Drains", null, [nearby], raleigh).resolution).toBe("matched");
	});

	it("needs the phone the answer gives", () => {
		const near = candidate("Oak City Plumbing", inRaleigh, { phone: "+19195550100" });
		expect(pickCandidate("Oak City Plumbing", "+19195550100", [near], raleigh).resolution).toBe("matched");
		expect(pickCandidate("Oak City Plumbing", "+13035550100", [near], raleigh).resolution).toBe("none");
	});

	it("says a name Google places only elsewhere is a namesake's", () => {
		const result = pickCandidate("Brothers Plumbing", null, [candidate("Brothers Plumbing", inDenver)], raleigh);
		expect(result).toEqual({ resolution: "elsewhere", placeId: null, cid: null });
	});

	it("finds nothing when no listing has that name, or none can be placed", () => {
		const other = candidate("Harris Brothers Plumbing", inRaleigh);
		expect(pickCandidate("Brothers Plumbing", null, [other], raleigh).resolution).toBe("none");
		expect(pickCandidate("Oak City Plumbing", null, [candidate("Oak City Plumbing", null)], raleigh).resolution).toBe(
			"none",
		);
	});
});
