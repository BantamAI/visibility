import { db } from "@workspace/lib/db/db";
import { brands, runExtractions, usageEvents } from "@workspace/lib/db/schema";
import type { StructuredResearchResult } from "@workspace/lib/providers";
import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { answerNamedBusinesses, runLocations } from "../schema";
import {
	type ExtractedBusinesses,
	extractionPrompt,
	NAMED_BUSINESSES_VERSION,
	type NamedBusiness,
	namedBusinessesFrom,
} from "./extract";

export const EXTRACTION_USAGE_EVENT = "named_businesses_extraction";

/** Caps a subject's extraction calls; a weekly scan of a busy subject is a few hundred answers. */
export const EXTRACTIONS_PER_DAY = 1000;

/** Answers are extracted a few at a time, so one tick doesn't hit the LLM's rate limit. */
const CONCURRENCY = 4;

export type Extract = (prompt: string) => Promise<StructuredResearchResult<ExtractedBusinesses>>;

/** The model returned something that isn't the list: asking again would cost the same and fail the same. */
const BAD_OUTPUT = new Set([
	"AI_NoObjectGeneratedError",
	"AI_TypeValidationError",
	"AI_JSONParseError",
	"ZodError",
	"SyntaxError",
]);

export interface ExtractedRuns {
	extracted: number;
	/** Runs whose answer the model couldn't list; they're stamped with no businesses until the next version. */
	failed: { runId: string; error: unknown }[];
}

async function extractionsToday(subjectId: string, now: Date): Promise<number> {
	const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	const [row] = await db
		.select({ calls: sql<number>`count(*)`.mapWith(Number) })
		.from(usageEvents)
		.where(
			and(
				eq(usageEvents.brandId, subjectId),
				eq(usageEvents.eventType, EXTRACTION_USAGE_EVENT),
				gte(usageEvents.createdAt, dayStart),
			),
		);
	return row?.calls ?? 0;
}

async function recordExtraction(subjectId: string, organizationId: string, model: string | undefined) {
	try {
		await db.insert(usageEvents).values({
			organizationId,
			brandId: subjectId,
			eventType: EXTRACTION_USAGE_EVENT,
			model: model ?? null,
			units: 1,
		});
	} catch (error) {
		console.error("[named-businesses] Couldn't record an extraction's usage:", error);
	}
}

/**
 * Lists the businesses named in the subject's located answers that were never listed, or were listed
 * by an older extraction, newest first. A run with no text is stamped with none. Stops at the first
 * call that fails for another reason than the model's output, leaving the rest for the next tick.
 * Runs in the caller's subject scope.
 */
export async function extractNamedBusinesses(
	extract: Extract,
	subjectId: string,
	limit: number,
	now = new Date(),
): Promise<ExtractedRuns> {
	const result: ExtractedRuns = { extracted: 0, failed: [] };
	const [brand] = await db
		.select({ organizationId: brands.organizationId })
		.from(brands)
		.where(eq(brands.id, subjectId))
		.limit(1);
	if (!brand) return result;
	const allowance = Math.min(limit, EXTRACTIONS_PER_DAY - (await extractionsToday(subjectId, now)));
	if (allowance <= 0) return result;
	const runs = await db
		.select({ runId: runLocations.runId, text: runExtractions.textContent })
		.from(runLocations)
		.innerJoin(runExtractions, eq(runExtractions.runId, runLocations.runId))
		.where(
			and(
				eq(runLocations.subjectId, subjectId),
				or(
					isNull(runLocations.namedBusinessesVersion),
					lt(runLocations.namedBusinessesVersion, NAMED_BUSINESSES_VERSION),
				),
			),
		)
		.orderBy(desc(runLocations.createdAt))
		.limit(allowance);

	/** The businesses in one answer; null when the model's output can't be read. Throws on any other failure. */
	const list = async (runId: string, text: string): Promise<NamedBusiness[] | null> => {
		try {
			const listed = await extract(extractionPrompt(text));
			await recordExtraction(subjectId, brand.organizationId, listed.modelVersion);
			return namedBusinessesFrom(listed.object);
		} catch (error) {
			if (!(error instanceof Error && BAD_OUTPUT.has(error.name))) throw error;
			await recordExtraction(subjectId, brand.organizationId, undefined);
			result.failed.push({ runId, error });
			return null;
		}
	};

	let stopped: unknown = null;
	let next = 0;
	const work = async () => {
		while (next < runs.length && stopped === null) {
			const { runId, text } = runs[next++];
			try {
				const named = text?.trim() ? await list(runId, text) : [];
				await storeNamed(subjectId, runId, named ?? []);
				result.extracted++;
			} catch (error) {
				stopped = error;
			}
		}
	};
	await Promise.all(Array.from({ length: CONCURRENCY }, work));
	if (stopped !== null) throw stopped;
	return result;
}

async function storeNamed(subjectId: string, runId: string, named: NamedBusiness[]): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.delete(answerNamedBusinesses).where(eq(answerNamedBusinesses.runId, runId));
		if (named.length > 0) {
			await tx.insert(answerNamedBusinesses).values(named.map((business) => ({ runId, subjectId, ...business })));
		}
		await tx
			.update(runLocations)
			.set({ namedBusinessesVersion: NAMED_BUSINESSES_VERSION })
			.where(eq(runLocations.runId, runId));
	});
}
