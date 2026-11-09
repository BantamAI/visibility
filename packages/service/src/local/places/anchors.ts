import { db } from "@workspace/lib/db/db";
import { brands, competitors } from "@workspace/lib/db/schema";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { GeocodedAddress, PlaceCandidate, PlacesProvider } from "../../providers/places";
import { type PlaceAnchor, placeAnchors, subjectServiceAreas } from "../schema";
import { distanceMeters, insideArea } from "../service-areas/geo";
import { recordPlacesUsage } from "./usage";

export class PlaceAnchorError extends Error {
	override name = "PlaceAnchorError";
}

export interface AnchorTarget {
	/** Null for the subject itself. */
	competitorName: string | null;
	name: string;
	anchor: PlaceAnchor | null;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The subject and each tracked competitor, with the Place ID each is anchored on, if any. */
export async function listAnchorTargets(subjectId: string): Promise<AnchorTarget[]> {
	const [[brand], tracked, anchors] = await Promise.all([
		db.select({ name: brands.name }).from(brands).where(eq(brands.id, subjectId)).limit(1),
		db
			.select({ name: competitors.name })
			.from(competitors)
			.where(eq(competitors.brandId, subjectId))
			.orderBy(asc(competitors.name)),
		db.select().from(placeAnchors).where(eq(placeAnchors.subjectId, subjectId)),
	]);
	if (!brand) return [];
	const subjectAnchor = anchors.find((anchor) => anchor.competitorName === null) ?? null;
	return [
		{ competitorName: null, name: brand.name, anchor: subjectAnchor },
		...tracked.map(({ name }) => ({
			competitorName: name,
			name,
			anchor: anchors.find((a) => a.competitorName !== null && sameName(a.competitorName, name)) ?? null,
		})),
	];
}

export interface FoundPlace extends PlaceCandidate {
	/** From the searched area's center; null when either has no coordinates. */
	distanceMeters: number | null;
	insideArea: boolean | null;
}

export interface PlaceSearch {
	area: { id: string; name: string } | null;
	candidates: FoundPlace[];
}

/** The given area, or else the subject's primary one (or its oldest, if none is marked primary). */
async function searchArea(subjectId: string, areaId?: string) {
	const [area] = await db
		.select()
		.from(subjectServiceAreas)
		.where(and(eq(subjectServiceAreas.subjectId, subjectId), areaId ? eq(subjectServiceAreas.id, areaId) : undefined))
		.orderBy(desc(subjectServiceAreas.isPrimary), asc(subjectServiceAreas.createdAt))
		.limit(1);
	if (areaId && !area) throw new PlaceAnchorError("That service area doesn't belong to this subject");
	return area ?? null;
}

/**
 * Searches Google for a business by name, leaning toward one of the subject's service areas, and
 * says how far each candidate is from it. Used to confirm anchors and to resolve unknown names.
 */
export async function findPlaces(
	provider: PlacesProvider,
	subjectId: string,
	input: { query: string; areaId?: string },
): Promise<PlaceSearch> {
	const query = input.query.trim();
	if (!query) throw new PlaceAnchorError("Enter a business name to search for");
	const area = await searchArea(subjectId, input.areaId);
	const bias = area && { lat: area.centerLat, lng: area.centerLng, radiusMeters: area.radiusMeters };
	const candidates = await recordPlacesUsage(subjectId, await provider.searchText(query, bias));
	return {
		area: area && { id: area.id, name: area.name },
		candidates: candidates.map((candidate) => {
			const located = area && candidate.lat !== null && candidate.lng !== null;
			const point = located ? { lat: candidate.lat as number, lng: candidate.lng as number } : null;
			return {
				...candidate,
				distanceMeters: area && point ? distanceMeters({ lat: area.centerLat, lng: area.centerLng }, point) : null,
				insideArea: area && point ? insideArea(point, area) : null,
			};
		}),
	};
}

const PLACE_ID = /^[\w-]{16,}$/;
const CID = /^\d{1,20}$/;

/** Anchors the subject, or one of its tracked competitors, on a Place ID, replacing any earlier one. */
export async function confirmAnchor(
	subjectId: string,
	input: {
		competitorName: string | null;
		placeId: string;
		cid: string | null;
		searchQuery: string;
		confirmedBy: string;
	},
): Promise<PlaceAnchor> {
	if (!PLACE_ID.test(input.placeId)) throw new PlaceAnchorError("That isn't a Google Place ID");
	if (input.cid !== null && !CID.test(input.cid)) throw new PlaceAnchorError("That isn't a Google Maps CID");
	let competitorName: string | null = null;
	if (input.competitorName !== null) {
		const wanted = input.competitorName;
		const tracked = await db
			.select({ name: competitors.name })
			.from(competitors)
			.where(eq(competitors.brandId, subjectId));
		const match = tracked.find(({ name }) => sameName(name, wanted));
		if (!match) throw new PlaceAnchorError(`"${wanted}" isn't a tracked competitor`);
		competitorName = match.name;
	}
	return db.transaction(async (tx) => {
		await tx.delete(placeAnchors).where(anchorOf(subjectId, competitorName));
		const now = new Date();
		const [anchor] = await tx
			.insert(placeAnchors)
			.values({
				subjectId,
				competitorName,
				placeId: input.placeId,
				cid: input.cid,
				searchQuery: input.searchQuery.trim(),
				confirmedBy: input.confirmedBy,
				confirmedAt: now,
				checkedAt: now,
			})
			.returning();
		return anchor;
	});
}

export async function removeAnchor(subjectId: string, competitorName: string | null): Promise<boolean> {
	const removed = await db
		.delete(placeAnchors)
		.where(anchorOf(subjectId, competitorName))
		.returning({ id: placeAnchors.id });
	return removed.length > 0;
}

function anchorOf(subjectId: string, competitorName: string | null) {
	return and(
		eq(placeAnchors.subjectId, subjectId),
		competitorName === null
			? isNull(placeAnchors.competitorName)
			: sql`lower(${placeAnchors.competitorName}) = lower(${competitorName.trim()})`,
	);
}

/**
 * For canaries. Google allows its coordinates to be cached for 30 days at most, so whoever
 * stores the result must expire it by then.
 */
export async function geocodeAddress(
	provider: PlacesProvider,
	subjectId: string,
	address: string,
): Promise<GeocodedAddress | null> {
	if (!address.trim()) throw new PlaceAnchorError("Enter an address to geocode");
	return recordPlacesUsage(subjectId, await provider.geocode(address.trim()));
}
