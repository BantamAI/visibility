import { z } from "zod";
import { e164, textOrNull } from "../answer-businesses/card";
import { nameKey } from "./names";

/** Bump when extraction changes, so every located run's businesses are listed again. */
export const NAMED_BUSINESSES_VERSION = 1;

/** Bounds the cost of a runaway answer; the businesses an answer names first are the ones that matter. */
const MAX_ANSWER_CHARS = 30_000;

/** More than any answer recommends; past this an answer is a directory dump. */
const MAX_BUSINESSES = 40;

const INLINE_DATA = /data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;

export const namedBusinessesSchema = z.object({
	businesses: z.array(
		z.object({
			name: z.string(),
			phone: z.string().nullable(),
			address: z.string().nullable(),
			website: z.string().nullable(),
		}),
	),
});

export type ExtractedBusinesses = z.infer<typeof namedBusinessesSchema>;

export interface NamedBusiness {
	position: number;
	name: string;
	nameKey: string;
	/** E.164. */
	phone: string | null;
	address: string | null;
	website: string | null;
}

export function extractionPrompt(answer: string): string {
	const text = answer.replace(INLINE_DATA, "").slice(0, MAX_ANSWER_CHARS);
	return `Below is an answer an AI assistant gave to someone looking for a local business or service.

List every business the answer names, in the order it first names them: companies that do the work or sell to the customer, such as contractors, shops, clinics, firms and franchises. Include a business named only in passing, and each location of a chain the answer names separately.

Leave out:
- directories, review sites, marketplaces and lead services (Yelp, Angi, HomeAdvisor, Thumbtack, BBB, Nextdoor, Google)
- manufacturers and product brands the answer mentions as products, not as someone to hire
- publications, government bodies, trade associations and the AI itself
- generic descriptions that aren't names ("a licensed plumber", "local companies")

For each business give:
- name: exactly as the answer writes it
- phone: only if the answer gives one for it, as written; otherwise null
- address: only if the answer gives a street address or a city for it, as written; otherwise null
- website: only if the answer gives a link or domain for it; otherwise null

Never add details the answer doesn't give. If it names no business, return an empty list.

<answer>
${text}
</answer>`;
}

/** The model's list, cleaned: names trimmed, phones in E.164, each listing once, numbered from 1. */
export function namedBusinessesFrom(extracted: ExtractedBusinesses): NamedBusiness[] {
	const seen = new Set<string>();
	const named: NamedBusiness[] = [];
	for (const business of extracted.businesses) {
		const name = textOrNull(business.name);
		const key = name && nameKey(name);
		if (!name || !key) continue;
		const phone = e164(business.phone);
		const address = textOrNull(business.address);
		// A chain's locations share a name; the answer tells them apart by phone or address.
		const identity = JSON.stringify([key, phone, address]);
		if (seen.has(identity)) continue;
		seen.add(identity);
		named.push({
			position: named.length + 1,
			name,
			nameKey: key,
			phone,
			address,
			website: textOrNull(business.website),
		});
		if (named.length === MAX_BUSINESSES) break;
	}
	return named;
}
