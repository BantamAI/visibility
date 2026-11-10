import { type MentionAssessment, type RunMentionAssessments, wholeWordPattern } from "@workspace/lib/mentions";
import type { BusinessCard, CardPlacement } from "../answer-businesses/card";
import type { LocalMatchMethod, LocalMentionReview } from "../schema";

/** The subject (no `competitorName`) or one of its tracked competitors, with what identifies it locally. */
export interface TrackedBusiness {
	competitorName: string | null;
	name: string;
	aliases: string[];
	/** Websites or bare domains; a website with a path matches only pages under it. */
	websites: string[];
	placeId: string | null;
	cid: string | null;
	/** E.164. */
	phone: string | null;
}

export type MatchableCard = Pick<
	BusinessCard,
	"placement" | "position" | "name" | "placeId" | "cid" | "phone" | "website" | "address"
>;

/** Whether a card's business is in or near the subject's areas; null when its address doesn't say. */
export type NearArea = (card: MatchableCard) => boolean | null;

export interface LocalMatch {
	competitorName: string | null;
	counted: boolean;
	method: LocalMatchMethod;
	confidence: number;
	review: LocalMentionReview | null;
	card: { placement: CardPlacement; position: number } | null;
}

type CardMethod = Extract<LocalMatchMethod, "place_id" | "cid" | "phone" | "url">;

/** Strongest first. A phone can be a shared call centre's, and a website a franchise's. */
const CARD_METHODS: { method: CardMethod; confidence: number }[] = [
	{ method: "place_id", confidence: 1 },
	{ method: "cid", confidence: 1 },
	{ method: "phone", confidence: 0.95 },
	{ method: "url", confidence: 0.9 },
];

function site(url: string): { host: string; path: string } | null {
	try {
		const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
		return {
			host: parsed.hostname.replace(/^www\./, "").toLowerCase(),
			path: parsed.pathname.replace(/\/+$/, "").toLowerCase(),
		};
	} catch {
		return null;
	}
}

function sameSite(cardWebsite: string, website: string): boolean {
	const card = site(cardWebsite);
	const own = site(website);
	if (!card || !own || card.host !== own.host) return false;
	return own.path === "" || card.path === own.path || card.path.startsWith(`${own.path}/`);
}

/** A card with a Place ID or CID other than the business's own is another listing, whatever else it shares. */
function otherListing(card: MatchableCard, business: TrackedBusiness): boolean {
	if (card.placeId && business.placeId) return card.placeId !== business.placeId;
	if (card.cid && business.cid) return card.cid !== business.cid;
	return false;
}

function cardMethod(card: MatchableCard, business: TrackedBusiness): CardMethod | null {
	if (otherListing(card, business)) return null;
	if (card.placeId && card.placeId === business.placeId) return "place_id";
	if (card.cid && card.cid === business.cid) return "cid";
	if (card.phone && card.phone === business.phone) return "phone";
	if (card.website && business.websites.some((website) => sameSite(card.website as string, website))) return "url";
	return null;
}

function bestCard(cards: MatchableCard[], business: TrackedBusiness) {
	for (const { method, confidence } of CARD_METHODS) {
		const card = cards.find((candidate) => cardMethod(candidate, business) === method);
		if (card) return { method, confidence, card };
	}
	return null;
}

function namesIt(card: MatchableCard, business: TrackedBusiness): boolean {
	return [business.name, ...business.aliases]
		.map((term) => term.trim())
		.filter(Boolean)
		.some((term) => wholeWordPattern(term).test(card.name));
}

function assessmentOf(business: TrackedBusiness, assessments: RunMentionAssessments | null) {
	if (!assessments) return undefined;
	return business.competitorName === null ? assessments.brand : assessments.competitors[business.competitorName];
}

const comparable = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

/** "Roto-Rooter Plumbing & Water Cleanup" is a Roto-Rooter; "Harris Brothers Plumbing" isn't a Brothers Plumbing. */
function sameBrand(card: MatchableCard, business: TrackedBusiness): boolean {
	const name = comparable(card.name);
	return [business.name, ...business.aliases]
		.map(comparable)
		.filter(Boolean)
		.some((term) => name === term || name.startsWith(`${term} `));
}

/**
 * Below this, the judge can't rule the name out but isn't sure of it either. Elmo counts such a
 * name; with nothing else to go on, a local mention doesn't, since chains and common words make
 * doubtful names mostly namesakes.
 */
export const SURE_TEXT_MATCH = 0.8;

function textMatch(
	business: TrackedBusiness,
	assessment: MentionAssessment,
	cards: MatchableCard[],
	nearArea: NearArea,
): LocalMatch {
	const base = { competitorName: business.competitorName, method: "text+jev" as const, card: null };
	const confidence = assessment.probability;
	if (!assessment.mentioned) return { ...base, counted: false, confidence, review: null };
	const namesakes = cards.filter((card) => namesIt(card, business));
	const brand = namesakes.filter((card) => sameBrand(card, business));
	// Another listing of the same name nearby: a second location or branch of the business.
	if (brand.some((card) => nearArea(card) === true))
		return { ...base, counted: true, confidence, review: "other_listing" };
	const elsewhere = brand.some((card) => {
		const near = nearArea(card);
		return near === false || (near === null && otherListing(card, business));
	});
	// The answer shows a namesake's card, or another company whose name contains this one: the name means that.
	if (elsewhere || namesakes.some((card) => !sameBrand(card, business)))
		return { ...base, counted: false, confidence, review: "namesake_card" };
	if (confidence < SURE_TEXT_MATCH) return { ...base, counted: false, confidence, review: "doubtful" };
	// Counted, but nothing ties it to the business's listing yet.
	return { ...base, counted: true, confidence, review: "unresolved" };
}

/**
 * Matches a located run's answer cards and the judge's assessments to the subject and its tracked
 * competitors: a card that carries a business's Place ID, CID, phone or website first, then the
 * judge's reading of the text, checked against the cards that share the name. Only cards in the
 * answer count; the map pack beside an AI Overview is Google's ordinary local ranking, not the AI's.
 */
export function matchLocalMentions(
	businesses: TrackedBusiness[],
	cards: MatchableCard[],
	assessments: RunMentionAssessments | null,
	nearArea: NearArea,
): LocalMatch[] {
	const answerCards = cards.filter((card) => card.placement === "answer").sort((a, b) => a.position - b.position);
	return businesses.flatMap((business): LocalMatch[] => {
		const structured = bestCard(answerCards, business);
		if (structured) {
			const { method, confidence, card } = structured;
			return [
				{
					competitorName: business.competitorName,
					counted: true,
					method,
					confidence,
					review: null,
					card: { placement: card.placement, position: card.position },
				},
			];
		}
		const assessment = assessmentOf(business, assessments);
		return assessment ? [textMatch(business, assessment, answerCards, nearArea)] : [];
	});
}
