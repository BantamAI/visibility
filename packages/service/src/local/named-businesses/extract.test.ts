import { describe, expect, it } from "vitest";
import { extractionPrompt, namedBusinessesFrom } from "./extract";

const business = (name: string, fields: { phone?: string; address?: string; website?: string } = {}) => ({
	name,
	phone: fields.phone ?? null,
	address: fields.address ?? null,
	website: fields.website ?? null,
});

describe("listing the businesses an answer names", () => {
	it("numbers them in the order named, with phones in E.164", () => {
		const named = namedBusinessesFrom({
			businesses: [business(" Oak City Plumbing ", { phone: "(919) 555-0100" }), business("Triangle Rooter")],
		});
		expect(named).toEqual([
			{
				position: 1,
				name: "Oak City Plumbing",
				nameKey: "oak city plumbing",
				phone: "+19195550100",
				address: null,
				website: null,
			},
			{ position: 2, name: "Triangle Rooter", nameKey: "triangle rooter", phone: null, address: null, website: null },
		]);
	});

	it("lists a business named twice once, but each location of a chain", () => {
		const named = namedBusinessesFrom({
			businesses: [
				business("Roto-Rooter"),
				business("Roto Rooter"),
				business("Roto-Rooter", { address: "Cary, NC" }),
				business("  "),
			],
		});
		expect(named.map(({ position, address }) => [position, address])).toEqual([
			[1, null],
			[2, "Cary, NC"],
		]);
	});

	it("drops a phone it can't read rather than storing it", () => {
		const [named] = namedBusinessesFrom({ businesses: [business("Oak City Plumbing", { phone: "call us" })] });
		expect(named.phone).toBeNull();
	});

	it("leaves inline images out of what the model reads", () => {
		const prompt = extractionPrompt("Try Oak City Plumbing. ![logo](data:image/png;base64,iVBORw0KGgoAAAA)");
		expect(prompt).toContain("Try Oak City Plumbing.");
		expect(prompt).not.toContain("base64");
	});
});
