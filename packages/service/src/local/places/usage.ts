import { db } from "@workspace/lib/db/db";
import { brands, usageEvents } from "@workspace/lib/db/schema";
import { eq } from "drizzle-orm";
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
