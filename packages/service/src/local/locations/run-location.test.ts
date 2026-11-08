import { describe, expect, it } from "vitest";
import { googleUule, toRunLocation } from "./run-location";

describe("googleUule", () => {
	it("encodes a canonical name the way Google does", () => {
		expect(googleUule("United States")).toBe("w+CAIQICINVW5pdGVkIFN0YXRlcw");
	});
});

describe("toRunLocation", () => {
	const point = {
		id: "30000000-0000-0000-0000-000000000001",
		lat: 35.78,
		lng: -78.64,
		city: "Raleigh",
		region: "NC",
		country: "US",
		postalCode: "27601",
		timezone: "America/New_York",
		googleCanonicalName: "Raleigh,North Carolina,United States",
	};

	it("carries every field a provider might send, with the uule worked out in advance", () => {
		expect(toRunLocation(point)).toStrictEqual({
			pointId: point.id,
			latitude: 35.78,
			longitude: -78.64,
			city: "Raleigh",
			region: "NC",
			country: "US",
			postalCode: "27601",
			timezone: "America/New_York",
			googleCanonicalName: "Raleigh,North Carolina,United States",
			uule: googleUule("Raleigh,North Carolina,United States"),
		});
	});

	it("leaves out what a point far from any place lacks, so routes that need it refuse", () => {
		const location = toRunLocation({ ...point, city: null, region: null, postalCode: null, googleCanonicalName: null });
		expect(Object.keys(location).sort()).toEqual(["country", "latitude", "longitude", "pointId", "timezone"]);
	});
});
