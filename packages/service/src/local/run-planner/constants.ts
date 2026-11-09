/** Prompts with this tag ask "near me" and run on the grid; the rest name a city and run on centroids. */
export const NEAR_ME_TAG = "near-me";

export const MAX_INTERVAL_DAYS = 31;
export const MAX_REPEATS = 5;

/**
 * Elmo's own loop runs every prompt on every engine with no location, outside every
 * subject's budget, and a "near me" prompt with no location measures nothing. Only the
 * run planner's located runs spend.
 */
export const BRAND_MODE_RUNS = false;
