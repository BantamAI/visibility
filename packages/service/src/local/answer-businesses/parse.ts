import { cloroAnswer, searchapiAnswer } from "@workspace/lib/text-extraction";
import {
	type BusinessCard,
	type CardFields,
	cidInUrl,
	cidOrNull,
	coordinates,
	e164,
	numberOrNull,
	placeIdInUrl,
	placeIdOrNull,
	rank,
	textOrNull,
	websiteOrNull,
} from "./card";
import { googleMarkdownCards } from "./google-markdown";

/** Bump to re-derive every located run's cards from its stored `raw_output`. */
export const ANSWER_BUSINESSES_VERSION = 1;

type Json = Record<string, any>;

function list(value: unknown): Json[] {
	return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

function named(name: unknown, fields: Omit<CardFields, "name">): CardFields | null {
	const text = textOrNull(name);
	return text ? { name: text, ...fields } : null;
}

function dataforseoPackCard(item: Json): CardFields | null {
	return named(item.title, {
		placeId: placeIdOrNull(item.place_id) ?? placeIdInUrl(item.booking_url),
		cid: cidOrNull(item.cid),
		phone: e164(item.phone),
		address: null,
		latitude: null,
		longitude: null,
		rating: numberOrNull(item.rating?.value),
		reviewCount: numberOrNull(item.rating?.votes_count),
		website: websiteOrNull(item.url),
	});
}

function dataforseoChatGptCard(item: Json): CardFields | null {
	return named(item.title, {
		placeId: null,
		cid: null,
		phone: e164(item.phone),
		address: textOrNull(item.address),
		latitude: null,
		longitude: null,
		rating: numberOrNull(item.rating?.value),
		reviewCount: numberOrNull(item.rating?.votes_count ?? item.reviews_count),
		website: websiteOrNull(item.url),
	});
}

/**
 * Google's AI answers carry their cards only in the markdown; the organic SERP adds the map
 * pack beside the overview, where sponsored listings are skipped. The ChatGPT scraper lists
 * its cards as items.
 */
function dataforseoCards(raw: Json): BusinessCard[] {
	const items = list(raw?.tasks?.[0]?.result?.[0]?.items);
	// Only the first overview is the answer, as in Elmo's text extraction.
	const overview = items.find((item) => item.type === "ai_overview");
	const markdown = typeof overview?.markdown === "string" ? googleMarkdownCards(overview.markdown) : [];
	const chatgpt = items
		.filter((item) => item.type === "chat_gpt_local_businesses")
		.flatMap((item) => list(item.items))
		.map(dataforseoChatGptCard);
	const pack = items
		.filter((item) => item.type === "local_pack" && !item.is_paid)
		.sort((a, b) => (numberOrNull(a.rank_group) ?? 0) - (numberOrNull(b.rank_group) ?? 0))
		.map(dataforseoPackCard);
	return [...rank("answer", [...markdown, ...chatgpt]), ...rank("local_pack", pack)];
}

/** Cloro's Google cards (`map`, or `places` without coordinates) and its ChatGPT cards share one mapper. */
function cloroCard(item: Json): CardFields | null {
	return named(item.title ?? item.name, {
		placeId: placeIdOrNull(item.id) ?? placeIdInUrl(item.providerUrl),
		cid: cidOrNull(item.cid) ?? cidInUrl(item.link) ?? cidInUrl(item.links?.directions),
		phone: e164(item.phone),
		address: textOrNull(item.address),
		...coordinates(item.gpsCoordinates?.latitude ?? item.latitude, item.gpsCoordinates?.longitude ?? item.longitude),
		rating: numberOrNull(item.rating),
		reviewCount: numberOrNull(item.reviews) ?? numberOrNull(item.reviewCount),
		website: websiteOrNull(item.website ?? item.websiteUrl ?? item.links?.website),
	});
}

function cloroCards(raw: Json): BusinessCard[] {
	const answer = cloroAnswer(raw);
	const map = list(answer?.map);
	return [
		...rank("answer", (map.length > 0 ? map : list(answer?.places)).map(cloroCard)),
		...rank("local_pack", list(raw?.localResults).map(cloroCard)),
	];
}

/** SearchApi puts the phone and full address only in the card's description. */
function fromDescription(description: unknown, label: "Phone" | "Address"): string | null {
	if (typeof description !== "string") return null;
	const value = new RegExp(`${label}:\\s*(.+?)(?=\\s+[A-Z][a-z]+:|$)`).exec(description)?.[1];
	return textOrNull(value);
}

function searchapiCard(item: Json): CardFields | null {
	return named(item.title, {
		placeId: placeIdOrNull(item.place_id),
		cid: cidOrNull(item.ludocid ?? item.data_cid) ?? cidInUrl(item.data_id),
		phone: e164(item.phone) ?? e164(fromDescription(item.description, "Phone")),
		address: fromDescription(item.description, "Address") ?? textOrNull(item.address),
		...coordinates(item.gps_coordinates?.latitude, item.gps_coordinates?.longitude),
		rating: numberOrNull(item.rating),
		reviewCount: numberOrNull(item.reviews),
		website: websiteOrNull(item.website),
	});
}

/** AI Mode answers at the top level; AI Overview nests the answer under the SERP, whose own `local_results` is the map pack. */
function searchapiCards(raw: Json): BusinessCard[] {
	const answer = searchapiAnswer(raw);
	const pack = answer === raw ? [] : list(raw?.local_results);
	return [
		...rank("answer", list(answer?.local_results).map(searchapiCard)),
		...rank("local_pack", pack.map(searchapiCard)),
	];
}

function brightdataCard(item: Json): CardFields | null {
	return named(item.name, {
		placeId: placeIdOrNull(item.id) ?? placeIdInUrl(item.provider_url),
		cid: null,
		phone: e164(item.phone ?? item.phone_number),
		address: textOrNull(item.address),
		...coordinates(item.latitude, item.longitude),
		rating: numberOrNull(item.rating),
		reviewCount: numberOrNull(item.review_count),
		website: websiteOrNull(item.website_url),
	});
}

/** ChatGPT's `business_locations` are its map cards in full; `map` is the same cards with less on each. */
function brightdataCards(raw: unknown): BusinessCard[] {
	const record: Json | undefined = Array.isArray(raw) ? raw[0] : (raw as Json);
	const locations = list(record?.business_locations);
	return rank("answer", (locations.length > 0 ? locations : list(record?.map)).map(brightdataCard));
}

const PARSERS: Record<string, (raw: any) => BusinessCard[]> = {
	dataforseo: dataforseoCards,
	cloro: cloroCards,
	searchapi: searchapiCards,
	brightdata: brightdataCards,
};

/** The business cards in a stored answer, by the provider that fetched it. Other providers' answers have none. */
export function parseAnswerBusinesses(rawOutput: unknown, provider: string | null): BusinessCard[] {
	if (!provider || !rawOutput || typeof rawOutput !== "object" || !Object.hasOwn(PARSERS, provider)) return [];
	return PARSERS[provider](rawOutput);
}
