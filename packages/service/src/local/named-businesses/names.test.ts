import { describe, expect, it } from "vitest";
import { nameKey, sameBusinessName } from "./names";

describe("comparing business names", () => {
	it("reads '&' as 'and' and ignores punctuation and a legal suffix", () => {
		expect(nameKey("Michael & Son, Inc.")).toBe(nameKey("Michael and Son"));
		expect(nameKey("Roto-Rooter Plumbing LLC")).toBe("roto rooter plumbing");
	});

	it("takes a longer listing name as the same business", () => {
		expect(sameBusinessName("Roto-Rooter", "Roto-Rooter Plumbing & Water Cleanup")).toBe(true);
		expect(sameBusinessName("Benjamin Franklin Plumbing of Raleigh", "Benjamin Franklin Plumbing")).toBe(true);
	});

	it("doesn't take a name inside another company's as the same business", () => {
		expect(sameBusinessName("Brothers Plumbing", "Harris Brothers Plumbing")).toBe(false);
		expect(sameBusinessName("Blanton Plumbing", "J. Blanton Plumbing")).toBe(false);
		expect(sameBusinessName("Wiz", "Wizard Plumbing")).toBe(false);
	});
});
