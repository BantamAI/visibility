import { db } from "@workspace/lib/db/db";
import { brands, usageEvents } from "@workspace/lib/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { PLACES_SKU_COST_USD, type PlacesResponse } from "../../providers/places";

export const PLACES_PROVIDER = "google-places";
export const PLACES_USAGE_EVENT = "places_call";

/** One usage event per billed call, with the SKU as its model. Never fails the caller: the call already happened. */
export async function recordPlacesUsage<T>(subjectId: string, response: PlacesResponse<T>): Promise<T> {
	try {
		const [brand] = await db
			.select({ organizationId: brands.organizationId })
			.from(brands)
			.where(eq(brands.id, subjectId))
			.limit(1);
		if (!brand) throw new Error(`No subject ${subjectId}`);
		await db.insert(usageEvents).values({
			organizationId: brand.organizationId,
			brandId: subjectId,
			eventType: PLACES_USAGE_EVENT,
			provider: PLACES_PROVIDER,
			model: response.sku,
			units: 1,
			estimatedCostUsd: PLACES_SKU_COST_USD[response.sku].toFixed(6),
		});
	} catch (error) {
		console.error("[places] Couldn't record a Places call's usage:", error);
	}
	return response.data;
}

/**
 * Text Search Enterprise is $0.035 a call, so this caps a subject's lookups at about $7 a day. Staff
 * searches, name lookups and competitor seeding share it.
 */
export const PLACES_CALLS_PER_DAY = 200;

/** The subject's Places calls since midnight UTC, whoever made them. */
export async function placesCallsToday(subjectId: string, now: Date): Promise<number> {
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
