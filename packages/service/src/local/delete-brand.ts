import { db } from "@workspace/lib/db/db";
import {
	brandOpportunities,
	brands,
	citations,
	competitors,
	promptRuns,
	prompts,
	rollupDirty,
} from "@workspace/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Upstream's brand foreign keys don't cascade, so children go first. Deleting prompt
 * runs and prompts cascades to run extractions, mentions and the per-prompt rollups,
 * and deleting the brand cascades to its citation-page rollups. Usage events stay:
 * they record spend that already happened.
 */
export async function deleteBrand(brandId: string): Promise<boolean> {
	return db.transaction(async (tx) => {
		await tx.delete(citations).where(eq(citations.brandId, brandId));
		await tx.delete(promptRuns).where(eq(promptRuns.brandId, brandId));
		await tx.delete(prompts).where(eq(prompts.brandId, brandId));
		await tx.delete(rollupDirty).where(eq(rollupDirty.brandId, brandId));
		await tx.delete(competitors).where(eq(competitors.brandId, brandId));
		await tx.delete(brandOpportunities).where(eq(brandOpportunities.brandId, brandId));
		const deleted = await tx.delete(brands).where(eq(brands.id, brandId)).returning({ id: brands.id });
		return deleted.length > 0;
	});
}
