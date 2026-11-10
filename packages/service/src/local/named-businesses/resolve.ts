import { db } from "@workspace/lib/db/db";
import { usageEvents } from "@workspace/lib/db/schema";
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { PlaceCandidate, PlacesProvider } from "../../providers/places";
import { type AreaCircle, NEAR_AREA_FACTOR } from "../local-mentions/near";
import { PLACES_USAGE_EVENT, recordPlacesUsage } from "../places/usage";
import { answerNamedBusinesses, type PlaceResolution, placeResolutions, runLocations, subjectServiceAreas } from "../schema";
import { distanceMeters } from "../service-areas/geo";
import { nameKey, sameBusinessName } from "./names";

export interface Resolved {
	resolution: PlaceResolution;
	placeId: string | null;
	cid: string | null;
}

const UNRESOLVED: Resolved = { resolution: "none", placeId: null, cid: null };

/**
 * The listing a name (and phone, when the answer gives one) refers to among Text Search's
 * candidates: one of that name in or near the subject's areas, the exact name before a longer one,
 * then in Google's order. A name Google places only elsewhere is a namesake's.
 */
export function pickCandidate(
	name: string,
	phone: string | null,
	candidates: PlaceCandidate[],
	areas: AreaCircle[],
): Resolved {
	const named = candidates.filter(
		(candidate) => sameBusinessName(candidate.name, name) && (phone === null || candidate.phone === phone),
	);
	const located = named.filter((candidate) => candidate.lat !== null && candidate.lng !== null);
	const near = located.filter((candidate) =>
		areas.some(
			(area) =>
				distanceMeters(area, { lat: candidate.lat as number, lng: candidate.lng as number }) <=
				area.radiusMeters * NEAR_AREA_FACTOR,
		),
	);
	const key = nameKey(name);
	const best = near.find((candidate) => nameKey(candidate.name) === key) ?? near[0];
	if (best) return { resolution: "matched", placeId: best.placeId, cid: best.cid };
	return located.length > 0 ? { resolution: "elsewhere", placeId: null, cid: null } : UNRESOLVED;
}

/** Google allows Place IDs to be kept indefinitely, but recommends refreshing them after a year. */
const MATCHED_MAX_AGE_DAYS = 365;
/** A name with no listing nearby may get one: a new business, or one Google lists late. */
const UNMATCHED_MAX_AGE_DAYS = 30;

/**
 * Text Search Enterprise is $0.035 a call, so this caps a subject's lookups at about $7 a day. Each
 * name is looked up once, so after the first scans most days need a handful.
 */
export const PLACES_CALLS_PER_DAY = 200;

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

/** Names the subject's answers give that were never looked up, or were looked up too long ago, newest first. */
async function dueNames(subjectId: string, limit: number, now: Date) {
	const stale = sql`(${placeResolutions.resolution} = 'matched' AND ${placeResolutions.resolvedAt} < ${daysAgo(now, MATCHED_MAX_AGE_DAYS)})
		OR (${placeResolutions.resolution} <> 'matched' AND ${placeResolutions.resolvedAt} < ${daysAgo(now, UNMATCHED_MAX_AGE_DAYS)})`;
	const latest = db
		.select({
			nameKey: answerNamedBusinesses.nameKey,
			phone: answerNamedBusinesses.phone,
			name: sql<string>`(array_agg(${answerNamedBusinesses.name} ORDER BY ${runLocations.createdAt} DESC))[1]`.as(
				"name",
			),
			lastSeen: sql<Date>`max(${runLocations.createdAt})`.as("last_seen"),
		})
		.from(answerNamedBusinesses)
		.innerJoin(runLocations, eq(runLocations.runId, answerNamedBusinesses.runId))
		.where(eq(answerNamedBusinesses.subjectId, subjectId))
		.groupBy(answerNamedBusinesses.nameKey, answerNamedBusinesses.phone)
		.as("latest");
	return db
		.select({ nameKey: latest.nameKey, phone: latest.phone, name: latest.name })
		.from(latest)
		.leftJoin(
			placeResolutions,
			and(
				eq(placeResolutions.subjectId, subjectId),
				eq(placeResolutions.nameKey, latest.nameKey),
				sql`${placeResolutions.phone} IS NOT DISTINCT FROM ${latest.phone}`,
			),
		)
		.where(sql`${placeResolutions.id} IS NULL OR ${stale}`)
		.orderBy(desc(latest.lastSeen), asc(latest.nameKey))
		.limit(limit);
}

async function callsToday(subjectId: string, now: Date): Promise<number> {
	const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	const [row] = await db
		.select({ calls: sql<number>`count(*)`.mapWith(Number) })
		.from(usageEvents)
		.where(
			and(
				eq(usageEvents.brandId, subjectId),
				eq(usageEvents.eventType, PLACES_USAGE_EVENT),
				gte(usageEvents.createdAt, dayStart),
			),
		);
	return row?.calls ?? 0;
}

export interface ResolvedNames {
	looked: number;
	matched: number;
}

/**
 * Looks up on Google the names the subject's answers give that aren't resolved yet, leaning toward
 * its primary area, and stores the Place ID of the listing each refers to. Runs whose answers give a
 * name whose resolution changed are matched again. Runs in the caller's subject scope.
 */
export async function resolveNamedBusinesses(
	provider: PlacesProvider,
	subjectId: string,
	limit: number,
	now = new Date(),
): Promise<ResolvedNames> {
	const result: ResolvedNames = { looked: 0, matched: 0 };
	const areas = await db
		.select()
		.from(subjectServiceAreas)
		.where(eq(subjectServiceAreas.subjectId, subjectId))
		.orderBy(desc(subjectServiceAreas.isPrimary), asc(subjectServiceAreas.createdAt));
	const [primary] = areas;
	if (!primary) return result;
	const allowance = Math.min(limit, PLACES_CALLS_PER_DAY - (await callsToday(subjectId, now)));
	if (allowance <= 0) return result;
	const circles = areas.map((area) => ({ lat: area.centerLat, lng: area.centerLng, radiusMeters: area.radiusMeters }));
	const bias = { lat: primary.centerLat, lng: primary.centerLng, radiusMeters: primary.radiusMeters };
	for (const due of await dueNames(subjectId, allowance, now)) {
		const candidates = await recordPlacesUsage(subjectId, await provider.searchText(due.name, bias));
		const resolved = pickCandidate(due.name, due.phone, candidates, circles);
		await storeResolution(subjectId, due, resolved, now);
		result.looked++;
		if (resolved.resolution === "matched") result.matched++;
	}
	return result;
}

async function storeResolution(
	subjectId: string,
	key: { nameKey: string; phone: string | null; name: string },
	resolved: Resolved,
	now: Date,
): Promise<void> {
	await db.transaction(async (tx) => {
		const [previous] = await tx
			.select()
			.from(placeResolutions)
			.where(
				and(
					eq(placeResolutions.subjectId, subjectId),
					eq(placeResolutions.nameKey, key.nameKey),
					sql`${placeResolutions.phone} IS NOT DISTINCT FROM ${key.phone}`,
				),
			)
			.for("update");
		const values = { ...resolved, searchQuery: key.name, resolvedAt: now };
		if (previous) await tx.update(placeResolutions).set(values).where(eq(placeResolutions.id, previous.id));
		else await tx.insert(placeResolutions).values({ subjectId, nameKey: key.nameKey, phone: key.phone, ...values });
		const unchanged =
			previous &&
			previous.resolution === resolved.resolution &&
			previous.placeId === resolved.placeId &&
			previous.cid === resolved.cid;
		if (unchanged) return;
		const runs = tx
			.select({ runId: answerNamedBusinesses.runId })
			.from(answerNamedBusinesses)
			.where(
				and(
					eq(answerNamedBusinesses.subjectId, subjectId),
					eq(answerNamedBusinesses.nameKey, key.nameKey),
					sql`${answerNamedBusinesses.phone} IS NOT DISTINCT FROM ${key.phone}`,
				),
			);
		await tx.update(runLocations).set({ localMentionsStamp: null }).where(inArray(runLocations.runId, runs));
	});
}
