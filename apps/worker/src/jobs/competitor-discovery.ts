import * as Sentry from "@sentry/node";
import {
	discoverCompetitors,
	seedCompetitors,
	subjectsWithServiceAreas,
} from "@workspace/service/local/competitor-discovery";
import { withSubject } from "@workspace/service/local/tenancy";
import {
	configuredPlacesProvider,
	PlacesNotConfiguredError,
	type PlacesProvider,
} from "@workspace/service/providers/places";

/** A new subject's services × areas are a handful of searches; more wait for the next tick. */
const SEARCHES_PER_TICK = 20;

function placesProvider(): PlacesProvider | null {
	try {
		return configuredPlacesProvider();
	} catch (error) {
		if (error instanceof PlacesNotConfiguredError) return null;
		throw error;
	}
}

async function discover(subjectId: string, places: PlacesProvider | null) {
	if (places) {
		const seeded = await seedCompetitors(places, subjectId, SEARCHES_PER_TICK);
		if (seeded.searched > 0) {
			console.log(`[competitors] Searched ${seeded.searched} service(s) of ${subjectId}, found ${seeded.found}`);
		}
	}
	const { added, removed } = await discoverCompetitors(subjectId);
	if (added.length > 0) console.log(`[competitors] Now tracking for ${subjectId}: ${added.join(", ")}`);
	if (removed.length > 0) console.log(`[competitors] No longer tracking for ${subjectId}: ${removed.join(", ")}`);
}

/**
 * Seeds each subject's competitors from Google for services and areas not searched yet, then ranks
 * every area's competitors and keeps Elmo's in step. Without a Places key nothing is seeded, but
 * businesses named in answers are still found. Runs with agency access to find the subjects.
 */
export async function discoverCompetitorsJob(): Promise<void> {
	const places = placesProvider();
	for (const subjectId of await subjectsWithServiceAreas()) {
		try {
			await withSubject(subjectId, () => discover(subjectId, places));
		} catch (error) {
			// One subject's failure mustn't hold up the others; it's tried again next tick.
			console.error(`[competitors] Couldn't discover the competitors of ${subjectId}:`, error);
			Sentry.captureException(error);
		}
	}
}
