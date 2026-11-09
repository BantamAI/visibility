import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BusinessCard } from "./card";
import { parseAnswerBusinesses } from "./parse";

function fixture(name: string): unknown {
	return JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), "utf8"));
}

const inAnswer = (cards: BusinessCard[]) => cards.filter((card) => card.placement === "answer");
const inPack = (cards: BusinessCard[]) => cards.filter((card) => card.placement === "local_pack");

describe("DataForSEO", () => {
	it("reads Google AI Mode's cards from its markdown, in the order shown", () => {
		const cards = parseAnswerBusinesses(fixture("dataforseo-ai-mode"), "dataforseo");
		expect(cards.map((card) => [card.position, card.name])).toEqual([
			[1, "Bee Quick Plumbing & Sewer"],
			[2, "Wiz Plumbing Inc."],
			[3, "LaCassa Plumbing"],
			[4, "Principle Plumbing, Inc."],
			[5, "Paul The Plumber"],
			[6, "Oncourse Heating, Cooling, Plumbing"],
		]);
		expect(cards[0]).toMatchObject({
			placement: "answer",
			rating: 5,
			reviewCount: 201,
			cid: "13015402275315520719",
			address: "1133 Elizabeth Ave, Naperville, IL 60540",
			website: "https://beequickplumbingsewersinc.com/",
		});
		expect(cards[5].reviewCount).toBe(1800);
	});

	it("keeps a card with no directions link, without a CID or address", () => {
		const card = parseAnswerBusinesses(fixture("dataforseo-ai-mode"), "dataforseo")[3];
		expect(card).toMatchObject({ name: "Principle Plumbing, Inc.", cid: null, address: null, rating: 5 });
	});

	it("separates an unrated card's name from the category sharing its line", () => {
		const [unrated, rated] = parseAnswerBusinesses(fixture("dataforseo-ai-mode-unrated"), "dataforseo");
		expect(unrated).toMatchObject({ name: "Colorado Water Works", rating: null, reviewCount: null });
		expect(rated).toMatchObject({ name: "Roto-Rooter Plumbing & Drain", rating: 4.8, reviewCount: 117 });
	});

	it("ranks an AI Overview's cards apart from the map pack beside it, skipping sponsored listings", () => {
		const cards = parseAnswerBusinesses(fixture("dataforseo-ai-overview"), "dataforseo");
		expect(inAnswer(cards)).toHaveLength(5);
		expect(inAnswer(cards)[0]).toMatchObject({
			position: 1,
			name: "William Parrish Plumbing",
			phone: "+19193430783",
			cid: "1414125086472960955",
		});
		expect(inPack(cards).map((card) => [card.position, card.name])).toEqual([
			[1, "William Parrish Plumbing"],
			[2, "Poseidon Plumbing LLC"],
			[3, "Crossroads Plumbing and Drain"],
		]);
		expect(inPack(cards)[0].placeId).toBe("ChIJeYDs30-TrIkRu3swF0b7nxM");
	});

	it("doesn't take a sentence that starts with “Call” for a card", () => {
		const raw = {
			tasks: [
				{
					result: [
						{
							items: [
								{
									type: "ai_overview",
									markdown:
										"Shut the water off first.\n\nCall `Acme Plumbing` at **+1-919-555-0100** or another plumber.\n\nCall off the search if it stops.",
								},
							],
						},
					],
				},
			],
		};
		expect(parseAnswerBusinesses(raw, "dataforseo")).toEqual([]);
	});

	it("reads the ChatGPT scraper's local business cards", () => {
		const cards = parseAnswerBusinesses(fixture("dataforseo-chatgpt"), "dataforseo");
		expect(cards).toHaveLength(2);
		expect(cards[0]).toMatchObject({
			placement: "answer",
			name: "Priority 1 Plumbing and Drain Services",
			phone: "+17037777940",
			rating: 5,
			reviewCount: 19,
		});
	});
});

describe("Cloro", () => {
	it("reads Google AI Mode's map cards with coordinates and CIDs, but not Knowledge Graph ids as Place IDs", () => {
		const cards = parseAnswerBusinesses(fixture("cloro-ai-mode"), "cloro");
		expect(cards).toHaveLength(4);
		expect(cards[0]).toMatchObject({
			name: "Westover Plumbing LLC",
			placeId: null,
			cid: "3476671629390006170",
			phone: "+19195326676",
			latitude: 35.7910006,
			longitude: -78.7138516,
			reviewCount: 228,
		});
	});

	it("ranks an AI Overview's cards apart from the map pack, and drops coordinates of 0,0", () => {
		const cards = parseAnswerBusinesses(fixture("cloro-ai-overview"), "cloro");
		expect(inAnswer(cards)).toHaveLength(5);
		expect(inPack(cards)).toHaveLength(3);
		expect(inAnswer(cards)[1]).toMatchObject({ name: "B.C. Plumbing Services", latitude: null, longitude: null });
		expect(inPack(cards)[0]).toMatchObject({ position: 1, cid: "11488911009457820345", reviewCount: 273 });
	});

	it("reads ChatGPT's map cards with their Place IDs", () => {
		const cards = parseAnswerBusinesses(fixture("cloro-chatgpt"), "cloro");
		expect(cards).toHaveLength(5);
		expect(cards[0]).toMatchObject({
			name: "Plumbs Up Plumbing - Greenville, NC",
			placeId: "ChIJbcaFZmL3NEMRu2UtK_e1R7A",
			phone: "+12523472053",
		});
	});
});

describe("SearchApi", () => {
	it("reads Google AI Mode's cards, taking the phone and full address from the description", () => {
		const cards = parseAnswerBusinesses(fixture("searchapi-ai-mode"), "searchapi");
		expect(cards).toHaveLength(4);
		expect(cards[0]).toMatchObject({
			name: "Westover Plumbing LLC",
			placeId: "ChIJHdHgnxX1rIkRmkd4Pm2ePzA",
			cid: "3476671629390006170",
			phone: "+19195326676",
			address: "5211 Hillsborough St, Raleigh, NC 27606",
		});
	});

	it("reads an AI Overview's cards, and the search page's own local results as its map pack", () => {
		const raw = fixture("searchapi-ai-overview") as { ai_overview: { local_results: object[] } };
		const pack = { local_results: raw.ai_overview.local_results.slice(0, 2) };
		const cards = parseAnswerBusinesses({ ...raw, ...pack }, "searchapi");
		expect(inAnswer(cards)).toHaveLength(4);
		expect(inAnswer(cards)[0]).toMatchObject({
			name: "Hyper Flow Service (Plumber)",
			address: "1130 S Cherokee St, Denver, CO",
		});
		expect(inPack(cards).map((card) => card.position)).toEqual([1, 2]);
	});
});

describe("Bright Data", () => {
	it("reads ChatGPT's business locations, with a Place ID only when the listing is Google's", () => {
		const cards = parseAnswerBusinesses(fixture("brightdata-chatgpt"), "brightdata");
		expect(cards).toHaveLength(5);
		expect(cards[0]).toMatchObject({ name: "Cali Rooter & Plumbing", placeId: null, phone: "+18183315842" });
		expect(cards[3]).toMatchObject({ name: "Pacific Plumbing Team", placeId: "ChIJc4bJDVG7woARGcaqkGcYYe0" });
	});

	it("falls back to the map list when business locations are missing", () => {
		const [record] = fixture("brightdata-chatgpt") as { map: object[] }[];
		const cards = parseAnswerBusinesses([{ map: record.map }], "brightdata");
		expect(cards).toHaveLength(5);
		expect(cards[3]).toMatchObject({ name: "Pacific Plumbing Team", phone: "+13236452537", placeId: null });
	});
});

it("finds no cards in answers from providers that show none", () => {
	expect(parseAnswerBusinesses({ content: [{ type: "text", text: "Call Acme" }] }, "anthropic-api")).toEqual([]);
	expect(parseAnswerBusinesses(fixture("dataforseo-ai-mode"), null)).toEqual([]);
});
