import { createHash } from "node:crypto";
import { db } from "@workspace/lib/db/db";
import { brands, competitors, runMentions } from "@workspace/lib/db/schema";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { answerBusinesses, businessContacts, localMentions, placeAnchors, runLocations } from "../schema";
import { type MatchableCard, matchLocalMentions, type TrackedBusiness } from "./match";

/** Bump when matching changes, so every located run is matched again. */
export const LOCAL_MENTIONS_VERSION = 1;

const sameName = (a: string | null, b: string | null) =>
	a === null || b === null ? a === b : a.trim().toLowerCase() === b.trim().toLowerCase();

/** The subject and its tracked competitors, with the Place IDs, CIDs, phones and websites that identify them. */
export async function trackedBusinesses(subjectId: string): Promise<TrackedBusiness[]> {
	const [[brand], tracked, anchors, contacts] = await Promise.all([
		db.select().from(brands).where(eq(brands.id, subjectId)).limit(1),
		db.select().from(competitors).where(eq(competitors.brandId, subjectId)),
		db.select().from(placeAnchors).where(eq(placeAnchors.subjectId, subjectId)),
		db.select().from(businessContacts).where(eq(businessContacts.subjectId, subjectId)),
	]);
	if (!brand) return [];
	const identity = (competitorName: string | null) => {
		const anchor = anchors.find((row) => sameName(row.competitorName, competitorName));
		const contact = contacts.find((row) => sameName(row.competitorName, competitorName));
		return { placeId: anchor?.placeId ?? null, cid: anchor?.cid ?? null, phone: contact?.phone ?? null };
	};
	return [
		{
			competitorName: null,
			name: brand.name,
			aliases: brand.aliases ?? [],
			websites: [brand.website, ...(brand.additionalDomains ?? [])],
			...identity(null),
		},
		...tracked
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((competitor) => ({
				competitorName: competitor.name,
				name: competitor.name,
				aliases: competitor.aliases ?? [],
				websites: competitor.domains ?? [],
				...identity(competitor.name),
			})),
	];
}

/** Changes when matching or anything it matches on does; a run's stamp adds its judgement and cards. */
export function localMentionsPrefix(businesses: TrackedBusiness[]): string {
	const digest = createHash("sha256").update(JSON.stringify(businesses)).digest("hex").slice(0, 16);
	return `${LOCAL_MENTIONS_VERSION}:${digest}`;
}

/** Keeps each insert well under Postgres's limit on bound parameters. */
const CHUNK_RUNS = 200;

/**
 * Matches the subject's located runs whose mentions were never matched, or were matched against
 * an older judgement, older cards or older business details, newest first. A run is matched once
 * both its cards and its judgement exist. Runs in the caller's subject scope.
 */
export async function deriveLocalMentions(subjectId: string, limit: number): Promise<number> {
	const businesses = await trackedBusinesses(subjectId);
	if (businesses.length === 0) return 0;
	const prefix = localMentionsPrefix(businesses);
	const runStamp = sql<string>`${prefix}::text || ':' || ${runMentions.stamp} || ':' || ${runLocations.businessesVersion}`;
	const stale = await db
		.select({ runId: runLocations.runId, stamp: runStamp, assessments: runMentions.assessments })
		.from(runLocations)
		.innerJoin(runMentions, eq(runMentions.runId, runLocations.runId))
		.where(
			and(
				eq(runLocations.subjectId, subjectId),
				isNotNull(runLocations.businessesVersion),
				isNotNull(runMentions.stamp),
				sql`${runLocations.localMentionsStamp} IS DISTINCT FROM ${runStamp}`,
			),
		)
		.orderBy(desc(runLocations.createdAt))
		.limit(limit);
	for (let i = 0; i < stale.length; i += CHUNK_RUNS)
		await matchChunk(subjectId, businesses, stale.slice(i, i + CHUNK_RUNS));
	return stale.length;
}

async function matchChunk(
	subjectId: string,
	businesses: TrackedBusiness[],
	runs: { runId: string; stamp: string; assessments: (typeof runMentions.$inferSelect)["assessments"] }[],
): Promise<void> {
	const runIds = runs.map((run) => run.runId);
	const cards = await db.select().from(answerBusinesses).where(inArray(answerBusinesses.runId, runIds));
	const cardsByRun = new Map<string, MatchableCard[]>();
	for (const card of cards) cardsByRun.set(card.runId, [...(cardsByRun.get(card.runId) ?? []), card]);
	const rows = runs.flatMap(({ runId, assessments }) =>
		matchLocalMentions(businesses, cardsByRun.get(runId) ?? [], assessments).map(({ card, ...match }) => ({
			runId,
			subjectId,
			...match,
			cardPlacement: card?.placement ?? null,
			cardPosition: card?.position ?? null,
		})),
	);
	await db.transaction(async (tx) => {
		await tx.delete(localMentions).where(inArray(localMentions.runId, runIds));
		if (rows.length > 0) await tx.insert(localMentions).values(rows);
		// The stamp read with the judgement, not today's: a run judged again meanwhile stays stale.
		const stamps = sql.join(
			runs.map((run) => sql`(${run.runId}::uuid, ${run.stamp}::text)`),
			sql`, `,
		);
		await tx.execute(sql`
			UPDATE ${runLocations} SET local_mentions_stamp = stamped.stamp
			FROM (VALUES ${stamps}) AS stamped(run_id, stamp)
			WHERE ${runLocations.runId} = stamped.run_id`);
	});
}

/** Subjects with located runs. Run with agency access. */
export async function subjectsWithLocatedRuns(): Promise<string[]> {
	const rows = await db.selectDistinct({ subjectId: runLocations.subjectId }).from(runLocations);
	return rows.map((row) => row.subjectId);
}
