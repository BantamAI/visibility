import * as Sentry from "@sentry/node";
import {
	type DerivedBusinesses,
	deriveAnswerBusinesses,
	staleBusinessRuns,
} from "@workspace/service/local/answer-businesses";
import { withSubject } from "@workspace/service/local/tenancy";

/** Enough to replay a few weeks of scans within a day of a parser change, a tick at a time. */
const RUNS_PER_TICK = 2000;

function reportFailures(subjectId: string, { failed }: DerivedBusinesses): void {
	for (const { runId, error } of failed) {
		console.error(`[answer-businesses] Couldn't parse the cards of run ${runId}:`, error);
		Sentry.withScope((scope) => {
			scope.setTag("queue", "answer-businesses");
			scope.setContext("run", { runId, subjectId });
			Sentry.captureException(error);
		});
	}
}

/** Derives one new run's cards right after it's saved. A failure leaves it to the next sweep. */
export async function deriveNewRunBusinesses(subjectId: string, runId: string): Promise<void> {
	try {
		reportFailures(subjectId, await deriveAnswerBusinesses([runId]));
	} catch (error) {
		console.error(`[answer-businesses] Couldn't derive the cards of run ${runId}; the sweep will:`, error);
		Sentry.captureException(error);
	}
}

/**
 * Derives the cards of located runs that have none yet or were read by an older parser, one
 * subject at a time. Runs with agency access to find them.
 */
export async function deriveAnswerBusinessesJob(): Promise<void> {
	for (const [subjectId, runIds] of await staleBusinessRuns(RUNS_PER_TICK)) {
		try {
			const result = await withSubject(subjectId, () => deriveAnswerBusinesses(runIds));
			reportFailures(subjectId, result);
			console.log(`[answer-businesses] Derived cards for ${result.derived} run(s) of ${subjectId}`);
		} catch (error) {
			// One subject's failure mustn't hold up the others; its runs are picked up next tick.
			console.error(`[answer-businesses] Couldn't derive cards for ${subjectId}:`, error);
			Sentry.captureException(error);
		}
	}
}
