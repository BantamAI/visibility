import { db } from "@workspace/lib/db/db";
import { and, asc, eq, isNull, lt } from "drizzle-orm";
import type { PlacesProvider } from "../../providers/places";
import { type PlaceAnchor, placeAnchors } from "../schema";
import { recordPlacesUsage } from "./usage";

/** Google recommends refreshing Place IDs older than 12 months. */
export const PLACE_ID_MAX_AGE_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Anchors not checked within the max age and not already known obsolete, by subject. Needs agency access. */
export async function dueAnchors(limit: number, now = new Date()): Promise<Map<string, PlaceAnchor[]>> {
	const rows = await db
		.select()
		.from(placeAnchors)
		.where(
			and(lt(placeAnchors.checkedAt, new Date(now.getTime() - PLACE_ID_MAX_AGE_DAYS * DAY_MS)), isNull(placeAnchors.obsoleteAt)),
		)
		.orderBy(asc(placeAnchors.checkedAt))
		.limit(limit);
	const bySubject = new Map<string, PlaceAnchor[]>();
	for (const row of rows) bySubject.set(row.subjectId, [...(bySubject.get(row.subjectId) ?? []), row]);
	return bySubject;
}

export interface RefreshedAnchors {
	current: number;
	changed: number;
	obsolete: number;
}

/**
 * Checks each anchor's Place ID with Google's free IDs-only lookup. A retired ID marks the anchor
 * obsolete for staff to confirm again; a replaced one is stored with its new CID.
 */
export async function refreshAnchors(
	provider: PlacesProvider,
	subjectId: string,
	anchors: readonly PlaceAnchor[],
	now = new Date(),
): Promise<RefreshedAnchors> {
	const result: RefreshedAnchors = { current: 0, changed: 0, obsolete: 0 };
	for (const anchor of anchors) {
		const check = await recordPlacesUsage(subjectId, await provider.checkPlaceId(anchor.placeId));
		if (check.status === "not_found") {
			await db.update(placeAnchors).set({ obsoleteAt: now }).where(eq(placeAnchors.id, anchor.id));
			result.obsolete++;
		} else if (check.placeId === anchor.placeId) {
			await db.update(placeAnchors).set({ checkedAt: now }).where(eq(placeAnchors.id, anchor.id));
			result.current++;
		} else {
			const cid = await recordPlacesUsage(subjectId, await provider.mapsCid(check.placeId));
			await db
				.update(placeAnchors)
				.set({ placeId: check.placeId, cid, checkedAt: now })
				.where(eq(placeAnchors.id, anchor.id));
			result.changed++;
		}
	}
	return result;
}
