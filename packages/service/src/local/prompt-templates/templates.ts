import { dedupeKey } from "@workspace/lib/bulk-prompts";
import { SYSTEM_TAGS } from "@workspace/lib/db/schema";
import { serviceTag } from "../competitor-discovery/tally";
import { cityTag, NEAR_ME_TAG } from "../run-planner/constants";

export const INTENT_TAG_PREFIX = "intent:";
export const CITY_NAMED_TAG = "city-named";

/** Every service gets all four, so businesses of the same kind are measured on the same questions. */
export const SERVICE_INTENTS = ["emergency", "cost", "best", "reviews"] as const;
export type ServiceIntent = (typeof SERVICE_INTENTS)[number];
export type Intent = ServiceIntent | "job" | "licensed" | "hours";

export const intentTag = (intent: Intent) => `${INTENT_TAG_PREFIX}${intent}`;

export interface TemplateCity {
	city: string;
	region: string | null;
}

export interface TemplateInput {
	business: string;
	services: readonly { name: string; jobs: readonly string[] }[];
	/** Cities that get a city-named variant of every service and job prompt. */
	cities: readonly TemplateCity[];
	/** Where the branded fact prompts place the business; without one, there are none. */
	factCity: TemplateCity | null;
}

export interface GeneratedPrompt {
	value: string;
	tags: string[];
}

/** Letter names that start with a vowel sound, for acronyms such as "HVAC". */
const VOWEL_SOUND_LETTERS = new Set("AEFHILMNORSX");

function article(noun: string): string {
	const word = noun.split(/\s+/)[0] ?? "";
	if (word.length > 1 && word === word.toUpperCase() && /^[A-Z]/.test(word)) {
		return VOWEL_SOUND_LETTERS.has(word[0] as string) ? "an" : "a";
	}
	return /^[aeiou]/i.test(word) ? "an" : "a";
}

const SERVICE_TEMPLATES: Record<ServiceIntent, (service: string, place: string) => string> = {
	emergency: (s, place) => `I need an emergency ${s} ${place}. Who should I call?`,
	cost: (s, place) => `How much does ${article(s)} ${s} ${place} charge?`,
	best: (s, place) => `Who is the best ${s} ${place}?`,
	reviews: (s, place) => `Which ${s} ${place} has the best reviews?`,
};

const jobTemplate = (job: string, place: string) => `Who can I hire for ${job} ${place}?`;

const cityText = ({ city, region }: TemplateCity) => (region ? `${city}, ${region}` : city);

interface Phrasing {
	place: string;
	tags: string[];
}

function phrasings(cities: readonly TemplateCity[]): Phrasing[] {
	return [
		{ place: "near me", tags: [NEAR_ME_TAG] },
		...cities.map((city) => ({
			place: `in ${cityText(city)}`,
			tags: [CITY_NAMED_TAG, cityTag(city.city, city.region)],
		})),
	];
}

/**
 * Every service asked with every intent, and each of its jobs, once "near me" and once
 * naming each city; then the branded fact prompts. Repeats are dropped.
 */
export function generateLocalPrompts(input: TemplateInput): GeneratedPrompt[] {
	const generated: GeneratedPrompt[] = [];
	const unbranded = [SYSTEM_TAGS.UNBRANDED];
	for (const service of input.services) {
		const serviceTags = [...unbranded, serviceTag(service.name)];
		for (const phrasing of phrasings(input.cities)) {
			for (const intent of SERVICE_INTENTS) {
				generated.push({
					value: SERVICE_TEMPLATES[intent](service.name, phrasing.place),
					tags: [...serviceTags, intentTag(intent), ...phrasing.tags],
				});
			}
			for (const job of service.jobs) {
				generated.push({
					value: jobTemplate(job, phrasing.place),
					tags: [...serviceTags, intentTag("job"), ...phrasing.tags],
				});
			}
		}
	}

	if (input.factCity) {
		const place = cityText(input.factCity);
		const tags = [SYSTEM_TAGS.BRANDED, CITY_NAMED_TAG, cityTag(input.factCity.city, input.factCity.region)];
		generated.push(
			{ value: `Is ${input.business} in ${place} licensed?`, tags: [...tags, intentTag("licensed")] },
			{ value: `What are the hours for ${input.business} in ${place}?`, tags: [...tags, intentTag("hours")] },
		);
	}

	const seen = new Set<string>();
	return generated.filter((prompt) => {
		const key = dedupeKey(prompt.value);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
