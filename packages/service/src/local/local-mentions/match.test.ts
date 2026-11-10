import type { MentionAssessment, RunMentionAssessments } from "@workspace/lib/mentions";
import { describe, expect, it } from "vitest";
import { type MatchableCard, matchLocalMentions, type TrackedBusiness } from "./match";

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
			assessments(mentioned(0.8)),
		);
		expect(matches).toEqual([
			expect.objectContaining({ competitorName: null, method: "text+jev", counted: true }),
			expect.objectContaining({ competitorName: "Triangle Rooter", method: "cid", counted: true }),
		]);
	});

	it("counts a text mention the judge confirms, flagged until it's tied to a listing", () => {
		expect(matchLocalMentions([subject], [], assessments(mentioned(0.82)))).toEqual([
			{
				competitorName: null,
				counted: true,
				method: "text+jev",
				confidence: 0.82,
				review: "unresolved",
				card: null,
			},
		]);
	});

	it("keeps a name the judge rules out, uncounted", () => {
		const ruledOut: MentionAssessment = { mentioned: false, probability: 0.1, reason: "other_company" };
		expect(matchLocalMentions([subject], [], assessments(ruledOut))[0]).toMatchObject({
			counted: false,
			method: "text+jev",
			review: null,
		});
	});

	it("doesn't count a name when the answer's card for it is a namesake's listing", () => {
		const namesake = card({ name: "Oak City Plumbing", placeId: "ChIJnamesakenamesak04" });
		expect(matchLocalMentions([subject], [namesake], assessments(mentioned()))[0]).toMatchObject({
			counted: false,
			method: "text+jev",
			review: "conflicting_card",
		});
	});

	it("finds a namesake's card by an alias too", () => {
		const namesake = card({ name: "Triangle Rooter & Drain of Durham", cid: "9999" });
		const [match] = matchLocalMentions([rival], [namesake], assessments(undefined, { "Triangle Rooter": mentioned() }));
		expect(match).toMatchObject({ counted: false, review: "conflicting_card" });
	});

	it("can't rule out a namesake card for a business with no Place ID or CID", () => {
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
