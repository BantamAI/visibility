import { db } from "@workspace/lib/db/db";
import { brands, competitors } from "@workspace/lib/db/schema";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { PlaceCandidate, PlacesProvider } from "../../providers/places";
import { type AreaCircle, NEAR_AREA_FACTOR } from "../local-mentions/near";
import { PLACES_CALLS_PER_DAY, placesCallsToday, recordPlacesUsage } from "../places/usage";
import { areaCompetitors, competitorSeedSearches, placeAnchors, subjectServiceAreas, subjectServices } from "../schema";
import { distanceMeters } from "../service-areas/geo";
import { placeNames } from "./discover";
import { competitorWebsite, isSubjectName } from "./tally";

/**
 * The listings a search for a service finds near an area, in Google's order, leaving out the subject
 * itself and any Google can't place.
 */
export function seedListings(
	candidates: readonly PlaceCandidate[],
	area: AreaCircle,
	subject: { name: string; aliases: readonly string[]; placeId: string | null },
): PlaceCandidate[] {
	return candidates.filter(
		(candidate) =>
			candidate.lat !== null &&
			candidate.lng !== null &&
			distanceMeters(area, { lat: candidate.lat, lng: candidate.lng }) <= area.radiusMeters * NEAR_AREA_FACTOR &&
			candidate.placeId !== subject.placeId &&
			!isSubjectName(candidate.name, subject),
	);
}

export interface Seeded {
	searched: number;
	found: number;
}

/**
 * Searches Google once for each of the subject's services in each of its areas not searched yet, and
 * keeps the businesses it finds near the area as that area's competitors, in Google's order, so a new
 * subject has competitors before its first scan. Shares the subject's daily Places allowance. Runs in
 * the caller's subject scope.
 */
export async function seedCompetitors(
	provider: PlacesProvider,
	subjectId: string,
	limit: number,
	now = new Date(),
): Promise<Seeded> {
	const result: Seeded = { searched: 0, found: 0 };
	const [brand] = await db
		.select({ name: brands.name, aliases: brands.aliases })
		.from(brands)
		.where(eq(brands.id, subjectId))
		.limit(1);
	if (!brand) return result;
	const pending = await db
		.select({ area: subjectServiceAreas, service: subjectServices })
		.from(subjectServiceAreas)
		.innerJoin(subjectServices, eq(subjectServices.subjectId, subjectServiceAreas.subjectId))
		.leftJoin(
			competitorSeedSearches,
			and(
				eq(competitorSeedSearches.areaId, subjectServiceAreas.id),
				eq(competitorSeedSearches.serviceId, subjectServices.id),
			),
		)
		.where(and(eq(subjectServiceAreas.subjectId, subjectId), isNull(competitorSeedSearches.id)))
		.orderBy(desc(subjectServiceAreas.isPrimary), asc(subjectServiceAreas.createdAt), asc(subjectServices.createdAt));
	const allowance = Math.min(limit, PLACES_CALLS_PER_DAY - (await placesCallsToday(subjectId, now)));
	if (pending.length === 0 || allowance <= 0) return result;
	const [subjectAnchor] = await db
		.select({ placeId: placeAnchors.placeId })
		.from(placeAnchors)
		.where(and(eq(placeAnchors.subjectId, subjectId), isNull(placeAnchors.competitorName)));
	const subject = { ...brand, placeId: subjectAnchor?.placeId ?? null };

	for (const { area, service } of pending.slice(0, allowance)) {
		const circle = { lat: area.centerLat, lng: area.centerLng, radiusMeters: area.radiusMeters };
		const candidates = await recordPlacesUsage(subjectId, await provider.searchText(service.name, circle));
		const listings = seedListings(candidates, circle, subject);
		await storeSeed(subjectId, area.id, service, listings);
		result.searched++;
		result.found += listings.length;
	}
	return result;
}

async function storeSeed(
	subjectId: string,
	areaId: string,
	service: { id: string; name: string },
	listings: PlaceCandidate[],
): Promise<void> {
	await db.transaction(async (tx) => {
		const [existing, anchors, tracked] = await Promise.all([
			tx.select().from(areaCompetitors).where(eq(areaCompetitors.subjectId, subjectId)),
			tx.select().from(placeAnchors).where(eq(placeAnchors.subjectId, subjectId)),
			tx.select({ name: competitors.name }).from(competitors).where(eq(competitors.brandId, subjectId)),
		]);
		const nameOf = placeNames(
			existing,
			anchors,
			tracked,
			new Map(listings.map((listing) => [listing.placeId, [listing.name]])),
		);
		for (const [i, listing] of listings.entries()) {
			await tx
				.insert(areaCompetitors)
				.values({
					subjectId,
					areaId,
					placeId: listing.placeId,
					cid: listing.cid,
					name: nameOf(listing.placeId) ?? listing.name,
					website: competitorWebsite(listing.website),
					seedRank: i + 1,
					services: [service.name],
				})
				.onConflictDoUpdate({
					target: [areaCompetitors.areaId, areaCompetitors.placeId],
					set: {
						seedRank: sql`least(${areaCompetitors.seedRank}, excluded.seed_rank)`,
						services: sql`array(SELECT DISTINCT unnest(${areaCompetitors.services} || excluded.services) ORDER BY 1)`,
						cid: sql`coalesce(${areaCompetitors.cid}, excluded.cid)`,
						website: sql`coalesce(${areaCompetitors.website}, excluded.website)`,
					},
				});
		}
		await tx.insert(competitorSeedSearches).values({
			subjectId,
			areaId,
			serviceId: service.id,
			searchQuery: service.name,
			found: listings.length,
		});
	});
}
