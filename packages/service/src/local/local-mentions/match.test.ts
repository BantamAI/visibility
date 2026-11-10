import type { MentionAssessment, RunMentionAssessments } from "@workspace/lib/mentions";
import { describe, expect, it } from "vitest";
import {
	type MatchableCard,
	matchLocalMentions as match,
	type NearArea,
	type ResolvedName,
	type TrackedBusiness,
} from "./match";

/** Places cards by the city in their address: Raleigh is the area. */
const nearRaleigh: NearArea = (card) => (card.address ? card.address.includes("Raleigh") : null);
const matchLocalMentions = (
	businesses: TrackedBusiness[],
	cards: MatchableCard[],
	assessments: RunMentionAssessments | null,
) => match(businesses, cards, assessments, nearRaleigh);

const subject: TrackedBusiness = {
	competitorName: null,
	name: "Oak City Plumbing",
	aliases: [],
	websites: ["https://oakcityplumbing.example/raleigh"],
	placeId: "ChIJoakcityoakcity01",
	cid: "1111",
	phone: "+19195550100",
};

const rival: TrackedBusiness = {
	competitorName: "Triangle Rooter",
	name: "Triangle Rooter",
	aliases: ["Triangle Rooter & Drain"],
	websites: ["triangle-rooter.example"],
	placeId: "ChIJtriangletriang02",
	cid: "2222",
	phone: "+19195550200",
};

function card(fields: Partial<MatchableCard>): MatchableCard {
	return {
		placement: "answer",
		position: 1,
		name: "Somebody Else",
		placeId: null,
		cid: null,
		phone: null,
		website: null,
		address: null,
		...fields,
	};
}

const mentioned = (probability = 0.9): MentionAssessment => ({ mentioned: true, probability, sentiment: "positive" });
const assessments = (
	brand: MentionAssessment | undefined,
	competitors: Record<string, MentionAssessment> = {},
): RunMentionAssessments => ({
	...(brand ? { brand } : {}),
	competitors,
	judged: { brand: "x", competitors: {} },
});

describe("matching a located answer to tracked businesses", () => {
	it.each([
		["place_id", { placeId: subject.placeId }, 1],
		["cid", { cid: subject.cid }, 1],
		["phone", { phone: subject.phone }, 0.95],
		["url", { website: "https://www.oakcityplumbing.example/raleigh/water-heaters" }, 0.9],
	] as const)("matches a card by %s, without the judge", (method, fields, confidence) => {
		const [match] = matchLocalMentions([subject], [card({ position: 2, ...fields })], null);
		expect(match).toEqual({
			competitorName: null,
			counted: true,
			method,
			confidence,
			review: null,
			card: { placement: "answer", position: 2 },
		});
	});

	it("prefers the strongest identifier, whichever card carries it", () => {
		const cards = [card({ position: 1, phone: subject.phone }), card({ position: 3, placeId: subject.placeId })];
		expect(matchLocalMentions([subject], cards, null)[0]).toMatchObject({
			method: "place_id",
			card: { position: 3 },
		});
	});

	it("doesn't match a franchise's page for another city by its website", () => {
		const other = card({ website: "https://oakcityplumbing.example/durham" });
		expect(matchLocalMentions([subject], [other], null)).toEqual([]);
	});

	it("doesn't match a card whose Place ID is another listing's, even sharing a phone", () => {
		const shared = card({ placeId: "ChIJsomewhereelse0003", phone: subject.phone });
		expect(matchLocalMentions([subject], [shared], null)).toEqual([]);
	});

	it("ignores the map pack beside the answer", () => {
		const pack = card({ placement: "local_pack", placeId: subject.placeId });
		expect(matchLocalMentions([subject], [pack], null)).toEqual([]);
	});

	it("matches the subject and competitors independently", () => {
		const matches = matchLocalMentions(
			[subject, rival],
			[card({ position: 1, cid: rival.cid })],
			assessments(mentioned(0.9)),
		);
		expect(matches).toEqual([
			expect.objectContaining({ competitorName: null, method: "text+jev", counted: true }),
			expect.objectContaining({ competitorName: "Triangle Rooter", method: "cid", counted: true }),
		]);
	});

	it("counts a text mention the judge is sure of, flagged until it's tied to a listing", () => {
		expect(matchLocalMentions([subject], [], assessments(mentioned(0.92)))).toEqual([
			{
				competitorName: null,
				counted: true,
				method: "text+jev",
				confidence: 0.92,
				review: "unresolved",
				card: null,
			},
		]);
	});

	it("keeps a name the judge can't rule out but isn't sure of, uncounted and flagged", () => {
		expect(matchLocalMentions([subject], [], assessments(mentioned(0.6)))[0]).toMatchObject({
			counted: false,
			confidence: 0.6,
			review: "doubtful",
		});
	});

	it("keeps a name the judge rules out, uncounted", () => {
		const ruledOut: MentionAssessment = { mentioned: false, probability: 0.1, reason: "other_company" };
		expect(matchLocalMentions([subject], [], assessments(ruledOut))[0]).toMatchObject({
			counted: false,
			method: "text+jev",
			review: null,
		});
	});

	it("counts another listing of the same name nearby, such as a second location", () => {
		const branch = card({ name: "Oak City Plumbing", cid: "3333", address: "2709 Campbell Rd, Raleigh, NC 27606" });
		expect(matchLocalMentions([subject], [branch], assessments(mentioned(0.5)))[0]).toMatchObject({
			counted: true,
			review: "other_listing",
			card: null,
		});
	});

	it.each([
		["placed elsewhere", { address: "1 Main St, Charlotte, NC 28202" }],
		["of another listing, unplaced", { placeId: "ChIJnamesakenamesak04" }],
	])("doesn't count a name when the answer's card for it is a namesake's, %s", (_, fields) => {
		const namesake = card({ name: "Oak City Plumbing of Charlotte", ...fields });
		expect(matchLocalMentions([subject], [namesake], assessments(mentioned()))[0]).toMatchObject({
			counted: false,
			method: "text+jev",
			review: "namesake_card",
		});
	});

	it("doesn't count a name that's part of another company's, as its card shows", () => {
		const longer = card({ name: "Harris Triangle Rooter Services", address: "5 Elm St, Raleigh, NC 27601" });
		const [match] = matchLocalMentions([rival], [longer], assessments(undefined, { "Triangle Rooter": mentioned() }));
		expect(match).toMatchObject({ counted: false, review: "namesake_card" });
	});

	it("finds a namesake's card by an alias too", () => {
		const namesake = card({ name: "Triangle Rooter & Drain of Durham", address: "9 Oak St, Durham, NC 27701" });
		const [match] = matchLocalMentions([rival], [namesake], assessments(undefined, { "Triangle Rooter": mentioned() }));
		expect(match).toMatchObject({ counted: false, review: "namesake_card" });
	});

	it("can't rule out an unplaced namesake card for a business with no Place ID or CID", () => {
		const unanchored = { ...subject, placeId: null, cid: null };
		const namesake = card({ name: "Oak City Plumbing", placeId: "ChIJnamesakenamesak04" });
		expect(matchLocalMentions([unanchored], [namesake], assessments(mentioned()))[0]).toMatchObject({
			counted: true,
			review: "unresolved",
		});
	});

	it("says nothing about a business the answer neither names nor shows", () => {
		expect(matchLocalMentions([subject, rival], [card({})], assessments(undefined))).toEqual([]);
	});
});

describe("resolving the names an answer gives through Google", () => {
	const named = (fields: Partial<ResolvedName>): ResolvedName => ({
		name: "Oak City Plumbing",
		resolution: "matched",
		placeId: subject.placeId,
		cid: subject.cid,
		...fields,
	});
	const resolve = (probability: number, names: ResolvedName[], business = subject) =>
		match([business], [], assessments(mentioned(probability)), nearRaleigh, names)[0];

	it("ties a text mention to the business's own listing", () => {
		expect(resolve(0.85, [named({})])).toMatchObject({ counted: true, method: "resolved", confidence: 0.9, review: null });
	});

	it("counts a doubtful mention once its name resolves to the business's listing", () => {
		expect(resolve(0.6, [named({})])).toMatchObject({ counted: true, method: "resolved", review: null });
	});

	it("matches the business by the longer name an answer gives it", () => {
		const longer = named({ name: "Oak City Plumbing & Drain, LLC", placeId: null, cid: subject.cid });
		expect(resolve(0.9, [longer])).toMatchObject({ counted: true, method: "resolved", review: null });
	});

	it("counts another listing of the name near the areas, flagged", () => {
		const branch = named({ placeId: "ChIJoakcitybranch0003", cid: "3333" });
		expect(resolve(0.9, [branch])).toMatchObject({ counted: true, method: "resolved", review: "other_listing" });
	});

	it("counts a listing near the areas for a business not yet anchored", () => {
		const unanchored = { ...subject, placeId: null, cid: null };
		expect(resolve(0.9, [named({})], unanchored)).toMatchObject({ counted: true, method: "resolved", review: null });
	});

	it("doesn't count a name Google places only in another city", () => {
		const elsewhere = named({ resolution: "elsewhere", placeId: null, cid: null });
		expect(resolve(0.95, [elsewhere])).toMatchObject({
			counted: false,
			method: "text+jev",
			confidence: 0.95,
			review: "namesake_place",
		});
	});

	it("ignores a longer name that belongs to another company", () => {
		const other = named({ name: "North Oak City Plumbing", placeId: "ChIJnorthoakcity00004" });
		expect(resolve(0.9, [other])).toMatchObject({ counted: true, method: "text+jev", review: "unresolved" });
	});

	it("leaves the judge's word until a name is looked up, or when Google finds none", () => {
		expect(resolve(0.9, [named({ resolution: null, placeId: null, cid: null })])).toMatchObject({
			review: "unresolved",
		});
		expect(resolve(0.6, [named({ resolution: "none", placeId: null, cid: null })])).toMatchObject({
			counted: false,
			review: "doubtful",
		});
	});

	it("keeps a card's evidence ahead of Google's", () => {
		const namesake = card({ name: "Oak City Plumbing", cid: "9999", address: "1 Main St, Durham, NC 27701" });
		const [result] = match([subject], [namesake], assessments(mentioned(0.9)), nearRaleigh, [named({})]);
		expect(result).toMatchObject({ counted: false, review: "namesake_card" });
	});

	it("doesn't override a judge who rules the business out", () => {
		const ruledOut: MentionAssessment = { mentioned: false, probability: 0.1, sentiment: "neutral" };
		const [result] = match([subject], [], assessments(ruledOut), nearRaleigh, [named({})]);
		expect(result).toMatchObject({ counted: false, method: "text+jev", review: null });
	});
});
