import * as Sentry from "@sentry/node";
import { parseScrapeTargets } from "@workspace/config/scrape-targets";
import { runStructuredCompletionPrompt } from "@workspace/lib/onboarding";
import { subjectsWithLocatedRuns } from "@workspace/service/local/local-mentions";
import {
	type Extract,
	extractNamedBusinesses,
	namedBusinessesSchema,
	resolveNamedBusinesses,
} from "@workspace/service/local/named-businesses";
import { withSubject } from "@workspace/service/local/tenancy";
import {
	configuredPlacesProvider,
	PlacesNotConfiguredError,
	type PlacesProvider,
} from "@workspace/service/providers/places";

/** Bounds one tick: a few minutes of LLM calls and Places lookups per subject. */
const EXTRACTIONS_PER_TICK = 40;
const LOOKUPS_PER_TICK = 40;

/**
 * The onboarding LLM. Its stub's canned research isn't a list of businesses, and every answer would
 * be stamped as naming none, so with the stub answers wait for a real one.
 */
function extractor(): Extract | null {
	const target = process.env.ONBOARDING_LLM_TARGET?.trim();
	if (target && parseScrapeTargets(target)[0]?.provider === "stub") return null;
	return (prompt) => runStructuredCompletionPrompt(prompt, namedBusinessesSchema);
}

function placesProvider(): PlacesProvider | null {
	try {
		return configuredPlacesProvider();
	} catch (error) {
		if (error instanceof PlacesNotConfiguredError) return null;
		throw error;
	}
}

async function listAndResolve(subjectId: string, extract: Extract | null, places: PlacesProvider | null) {
	if (extract) {
		const listed = await extractNamedBusinesses(extract, subjectId, EXTRACTIONS_PER_TICK);
		if (listed.extracted > 0) console.log(`[named-businesses] Listed ${listed.extracted} answer(s) of ${subjectId}`);
		for (const { runId, error } of listed.failed) {
			console.error(`[named-businesses] Couldn't list the businesses in run ${runId}:`, error);
		}
	}
	if (!places) return;
	const resolved = await resolveNamedBusinesses(places, subjectId, LOOKUPS_PER_TICK);
	if (resolved.looked > 0) {
		console.log(
			`[named-businesses] Looked up ${resolved.looked} name(s) of ${subjectId}, ${resolved.matched} near its areas`,
		);
	}
}

/**
 * Lists the businesses each located answer names, then looks up on Google the names not yet
 * resolved, one subject at a time. Without a Places key, names are listed but not looked up; with
 * the stub LLM, none are listed. Runs with agency access to find the subjects.
 */
export async function resolveNamedBusinessesJob(): Promise<void> {
	const extract = extractor();
	const places = placesProvider();
	if (!extract && !places) return;
	for (const subjectId of await subjectsWithLocatedRuns()) {
		try {
			await withSubject(subjectId, () => listAndResolve(subjectId, extract, places));
		} catch (error) {
			// One subject's failure mustn't hold up the others; its work is picked up next tick.
			console.error(`[named-businesses] Couldn't list or resolve the businesses of ${subjectId}:`, error);
			Sentry.captureException(error);
		}
	}
}
