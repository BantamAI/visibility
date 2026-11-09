import { type CardFields, cidInUrl, e164, NO_FIELDS, websiteOrNull } from "./card";

/**
 * Google's AI answers as DataForSEO renders them to markdown, where each business card is a
 * few header lines (name with rating and review count, category, open status and distance)
 * above a "Call[Directions](…) [Website](…)" line, with the answer's own bullets below:
 *
 *   Wiz Plumbing Inc.4.9 (433)
 *   Plumber
 *   Open 10S185 Schoger Dr 4.3 mi
 *   Call[Directions](https://www.google.com/maps/dir//…/data=…1s0x…:0x…) [Website](…)
 *
 *   - **Phone:** (630) 555-0100
 *
 * A card with no reviews has no rating, and its category then shares the name's line.
 */

const CALL_LINE = /^Call(\[|$)/;
const NAME_WITH_RATING = /^(.*?)\s*(\d\.\d) \(([\d.,]+)(K?)\)$/;
const STATUS_LINE = /^(Open|Closed|Opens|Closes|Temporarily|Permanently)\b/;
const DIRECTIONS = /\[Directions\]\((https:\/\/www\.google\.com\/maps\/dir\/\/([^/)]*)\/data=[^)]*)\)/;
const WEBSITE = /\[Website\]\(([^)\s]+)\)/;
const PHONE = /Phone:\s*([+\d(][\d\s().+-]{6,}\d)/i;
const ADDRESS = /^[-*]\s+(?:Address|Location):\s*(.+)$/i;
const CITATION = /\[\[\d+\]\]\([^)]*\)/g;
const TRAILING_ASIDE = /\s*\([^)]*\)\s*$/;

interface RawCard {
	header: string[];
	call: string;
	bullets: string[];
}

function headerAbove(lines: string[], callIndex: number): string[] {
	const header: string[] = [];
	for (let i = callIndex - 1; i >= 0; i--) {
		const line = lines[i];
		if (!line || line === "---" || line.startsWith("![")) break;
		header.unshift(line);
	}
	return header;
}

function bulletsBelow(lines: string[], callIndex: number): string[] {
	const bullets: string[] = [];
	for (let i = callIndex + 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		if (!/^[-*]\s/.test(line)) break;
		bullets.push(line.replace(/\*/g, "").replace(/^-?\s*/, "- "));
	}
	return bullets;
}

function rawCards(markdown: string): RawCard[] {
	const lines = markdown.split("\n").map((line) => line.trim());
	const cards: RawCard[] = [];
	lines.forEach((line, i) => {
		if (!CALL_LINE.test(line)) return;
		const header = headerAbove(lines, i);
		if (header.length > 0) cards.push({ header, call: line, bullets: bulletsBelow(lines, i) });
	});
	return cards;
}

function reviewCount(count: string, thousands: string): number {
	const value = Number(count.replace(/,/g, ""));
	return thousands ? Math.round(value * 1000) : value;
}

/** The categories the rated cards show, which an unrated card's name line ends with. */
function categoriesOf(cards: RawCard[]): Set<string> {
	const categories = new Set<string>();
	for (const { header } of cards) {
		if (NAME_WITH_RATING.test(header[0]) && header[1] && !STATUS_LINE.test(header[1])) categories.add(header[1]);
	}
	return categories;
}

function nameAndRating(header: string[], categories: Set<string>): Pick<CardFields, "name" | "rating" | "reviewCount"> {
	const rated = NAME_WITH_RATING.exec(header[0]);
	if (rated) return { name: rated[1], rating: Number(rated[2]), reviewCount: reviewCount(rated[3], rated[4]) };
	const category = [...categories].find((c) => header[0].endsWith(` ${c}`));
	return { name: category ? header[0].slice(0, -category.length - 1) : header[0], rating: null, reviewCount: null };
}

function decoded(component: string): string {
	try {
		return decodeURIComponent(component.replace(/\+/g, " "));
	} catch {
		return "";
	}
}

function addressOf(card: RawCard, directions: RegExpExecArray | null): string | null {
	const destination = directions ? decoded(directions[2]) : "";
	if (destination && destination !== "''") return destination;
	const address = card.bullets.map((bullet) => ADDRESS.exec(bullet)?.[1]).find(Boolean);
	// Drops citation links and a trailing aside like "(approx. 4 minutes away)".
	return address?.replace(CITATION, "").replace(TRAILING_ASIDE, "").trim() || null;
}

function cardFields(card: RawCard, categories: Set<string>): CardFields {
	const directions = DIRECTIONS.exec(card.call);
	const phone = PHONE.exec([...card.bullets, card.call].join("\n"))?.[1];
	return {
		...NO_FIELDS,
		...nameAndRating(card.header, categories),
		cid: directions ? cidInUrl(directions[1]) : null,
		phone: e164(phone),
		address: addressOf(card, directions),
		website: websiteOrNull(WEBSITE.exec(card.call)?.[1]),
	};
}

export function googleMarkdownCards(markdown: string): CardFields[] {
	const cards = rawCards(markdown);
	const categories = categoriesOf(cards);
	return cards.map((card) => cardFields(card, categories));
}
