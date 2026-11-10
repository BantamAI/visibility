import * as Sentry from "@sentry/node";
import { deriveLocalMentions, subjectsWithLocatedRuns } from "@workspace/service/local/local-mentions";
import { withSubject } from "@workspace/service/local/tenancy";

/** Enough to rematch a few weeks of scans within a day of a matching change, a tick at a time. */
const RUNS_PER_TICK = 2000;

/**
 * Matches located runs whose cards and judgement are in but whose mentions aren't matched, or
 * were matched on something since changed, one subject at a time. Runs with agency access to find them.
 */
export async function deriveLocalMentionsJob(): Promise<void> {
	for (const subjectId of await subjectsWithLocatedRuns()) {
		try {
			const derived = await withSubject(subjectId, () => deriveLocalMentions(subjectId, RUNS_PER_TICK));
			if (derived > 0) console.log(`[local-mentions] Matched ${derived} run(s) of ${subjectId}`);
		} catch (error) {
			// One subject's failure mustn't hold up the others; its runs are picked up next tick.
			console.error(`[local-mentions] Couldn't match runs of ${subjectId}:`, error);
			Sentry.captureException(error);
		}
	}
}
