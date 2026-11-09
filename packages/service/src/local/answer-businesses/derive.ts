import { db } from "@workspace/lib/db/db";
import { promptRuns } from "@workspace/lib/db/schema";
import { desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { answerBusinesses, runLocations } from "../schema";
import type { BusinessCard } from "./card";
import { ANSWER_BUSINESSES_VERSION, parseAnswerBusinesses } from "./parse";

/** Keeps each insert well under Postgres's limit on bound parameters. */
const CHUNK_RUNS = 200;

export interface DerivedBusinesses {
	derived: number;
	/** Runs the parser threw on. They keep any cards they had, and their stamp moves so they aren't retried until the next version. */
	failed: { runId: string; error: unknown }[];
}

async function deriveChunk(runIds: string[], result: DerivedBusinesses): Promise<void> {
	const runs = await db
		.select({
			id: promptRuns.id,
			subjectId: promptRuns.brandId,
			provider: promptRuns.provider,
			raw: promptRuns.rawOutput,
		})
		.from(promptRuns)
		.innerJoin(runLocations, eq(runLocations.runId, promptRuns.id))
		.where(inArray(promptRuns.id, runIds));
	const parsed: { runId: string; subjectId: string; cards: BusinessCard[] }[] = [];
	for (const run of runs) {
		try {
			parsed.push({ runId: run.id, subjectId: run.subjectId, cards: parseAnswerBusinesses(run.raw, run.provider) });
		} catch (error) {
			result.failed.push({ runId: run.id, error });
		}
	}
	const replaced = parsed.map((run) => run.runId);
	const rows = parsed.flatMap(({ runId, subjectId, cards }) =>
		cards.map(({ latitude, longitude, ...card }) => ({ runId, subjectId, ...card, lat: latitude, lng: longitude })),
	);
	await db.transaction(async (tx) => {
		if (replaced.length > 0) await tx.delete(answerBusinesses).where(inArray(answerBusinesses.runId, replaced));
		if (rows.length > 0) await tx.insert(answerBusinesses).values(rows);
		await tx
			.update(runLocations)
			.set({ businessesVersion: ANSWER_BUSINESSES_VERSION })
			.where(
				inArray(
					runLocations.runId,
					runs.map((run) => run.id),
				),
			);
	});
	result.derived += parsed.length;
}

/** Replaces the cards of these located runs with the current parser's reading of their stored answers. */
export async function deriveAnswerBusinesses(runIds: readonly string[]): Promise<DerivedBusinesses> {
	const result: DerivedBusinesses = { derived: 0, failed: [] };
	for (let i = 0; i < runIds.length; i += CHUNK_RUNS) await deriveChunk(runIds.slice(i, i + CHUNK_RUNS), result);
	return result;
}

/** Located runs whose cards were never derived or were derived by an older parser, newest first, by subject. */
export async function staleBusinessRuns(limit: number): Promise<Map<string, string[]>> {
	const rows = await db
		.select({ runId: runLocations.runId, subjectId: runLocations.subjectId })
		.from(runLocations)
		.where(or(isNull(runLocations.businessesVersion), lt(runLocations.businessesVersion, ANSWER_BUSINESSES_VERSION)))
		.orderBy(desc(runLocations.createdAt))
		.limit(limit);
	const bySubject = new Map<string, string[]>();
	for (const { runId, subjectId } of rows) bySubject.set(subjectId, [...(bySubject.get(subjectId) ?? []), runId]);
	return bySubject;
}
