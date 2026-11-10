/** Prompts with this tag ask "near me" and run on the grid; the rest name a city and run on centroids. */
export const NEAR_ME_TAG = "near-me";

/** A prompt tagged `city:<city>-<state>` names that city, so it runs only on that city's centroids. */
export const CITY_TAG_PREFIX = "city:";

export function cityTag(city: string, region: string | null): string {
	const slug = [city, region ?? ""]
		.join(" ")
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return `${CITY_TAG_PREFIX}${slug}`;
}

export const MAX_INTERVAL_DAYS = 31;
export const MAX_REPEATS = 5;

/**
 * Elmo's own loop runs every prompt on every engine with no location, outside every
 * subject's budget, and a "near me" prompt with no location measures nothing. Only the
 * run planner's located runs spend.
 */
export const BRAND_MODE_RUNS = false;
