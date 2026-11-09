/**
 * Where a card sat: in the AI answer itself, or in the search page's map pack beside it.
 * Each placement is ranked on its own.
 */
export type CardPlacement = "answer" | "local_pack";

/** One business card as every vendor's response is normalized to it. */
export interface BusinessCard {
	placement: CardPlacement;
	/** 1 for the first card in its placement. */
	position: number;
	name: string;
	/** Google's Place ID, only when the response gives a real one ("ChIJ…"), never a Knowledge Graph id. */
	placeId: string | null;
	/** Google Maps customer id, as a decimal string. */
	cid: string | null;
	/** E.164. */
	phone: string | null;
	address: string | null;
	latitude: number | null;
	longitude: number | null;
	rating: number | null;
	reviewCount: number | null;
	website: string | null;
}

export type CardFields = Omit<BusinessCard, "placement" | "position">;

export const NO_FIELDS: Omit<CardFields, "name"> = {
	placeId: null,
	cid: null,
	phone: null,
	address: null,
	latitude: null,
	longitude: null,
	rating: null,
	reviewCount: null,
	website: null,
};

/** Numbers this short or long are fragments of something else. */
const PHONE_DIGITS = { min: 8, max: 15 };

/** North American numbers, the only ones these surfaces show unprefixed, get +1. */
export function e164(phone: unknown): string | null {
	if (typeof phone !== "string") return null;
	const digits = phone.replace(/\D/g, "");
	if (phone.trim().startsWith("+")) {
		return digits.length >= PHONE_DIGITS.min && digits.length <= PHONE_DIGITS.max ? `+${digits}` : null;
	}
	if (digits.length === 10) return `+1${digits}`;
	if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
	return null;
}

export function placeIdOrNull(value: unknown): string | null {
	return typeof value === "string" && /^ChIJ[\w-]{10,}$/.test(value) ? value : null;
}

/** A Place ID inside a Maps URL: `place_id:…`, URL-encoded or not, or a booking link's `/place/…/`. */
export function placeIdInUrl(url: unknown): string | null {
	if (typeof url !== "string") return null;
	const match = /place_id(?::|%3A)(ChIJ[\w-]+)/i.exec(url) ?? /\/place\/(ChIJ[\w-]+)\//.exec(url);
	return match ? match[1] : null;
}

/** The CID inside a Maps link: `cid=…`, or the second half of a feature id (`0x…:0x…`). */
export function cidInUrl(url: unknown): string | null {
	if (typeof url !== "string") return null;
	const plain = /[?&]cid=(\d+)/.exec(url);
	if (plain) return plain[1];
	const feature = /0x[0-9a-f]+:(0x[0-9a-f]+)/i.exec(url);
	return feature ? BigInt(feature[1]).toString() : null;
}

export function cidOrNull(value: unknown): string | null {
	if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
	return typeof value === "string" && /^\d{1,20}$/.test(value) ? value : null;
}

/** Google's own redirects and ad links say nothing about the business's site. */
export function websiteOrNull(url: unknown): string | null {
	if (typeof url !== "string" || !/^https?:\/\//.test(url)) return null;
	try {
		const host = new URL(url).hostname.replace(/^www\./, "");
		return host === "google.com" || host.endsWith(".google.com") ? null : url;
	} catch {
		return null;
	}
}

export function numberOrNull(value: unknown): number | null {
	const number = typeof value === "string" ? Number(value.replace(/,/g, "")) : value;
	return typeof number === "number" && Number.isFinite(number) ? number : null;
}

export function textOrNull(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Some vendors send 0,0 for a business they couldn't place. */
export function coordinates(latitude: unknown, longitude: unknown): Pick<CardFields, "latitude" | "longitude"> {
	const lat = numberOrNull(latitude);
	const lng = numberOrNull(longitude);
	if (lat === null || lng === null || (lat === 0 && lng === 0)) return { latitude: null, longitude: null };
	return { latitude: lat, longitude: lng };
}

/** Numbers each placement's cards from 1 in the order given, dropping cards with no name. */
export function rank(placement: CardPlacement, cards: readonly (CardFields | null)[]): BusinessCard[] {
	return cards
		.filter((card): card is CardFields => card !== null && card.name.trim() !== "")
		.map((card, i) => ({ ...card, name: card.name.trim(), placement, position: i + 1 }));
}
