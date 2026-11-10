import * as Sentry from "@sentry/node";
import { dueAnchors, refreshAnchors } from "@workspace/service/local/places";
import { withSubject } from "@workspace/service/local/tenancy";
import { configuredPlacesProvider } from "@workspace/service/providers/places";

/** The checks are free, so this only bounds how long one tick takes. */
const ANCHORS_PER_TICK = 500;

/**
 * Refreshes Place IDs that haven't been checked in 12 months, one subject at a time. Runs with
 * agency access to find them.
 */
export async function refreshPlaceIdsJob(): Promise<void> {
	const due = await dueAnchors(ANCHORS_PER_TICK);
	if (due.size === 0) return;
	const provider = configuredPlacesProvider();
	for (const [subjectId, anchors] of due) {
		try {
			const result = await withSubject(subjectId, () => refreshAnchors(provider, subjectId, anchors));
			console.log(
				`[place-ids] ${subjectId}: ${result.current} current, ${result.changed} changed, ${result.obsolete} obsolete`,
			);
		} catch (error) {
			// One subject's failure mustn't hold up the others; its anchors are still due tomorrow.
			console.error(`[place-ids] Couldn't refresh the Place IDs of ${subjectId}:`, error);
			Sentry.captureException(error);
		}
	}
}
