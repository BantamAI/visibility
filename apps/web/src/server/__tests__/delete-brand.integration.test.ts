import { db } from "@workspace/lib/db/db";
import {
	brands,
	citations,
	competitors,
	promptRuns,
	prompts,
	rollupCitationPages,
	rollupPromptRuns,
} from "@workspace/lib/db/schema";
import { deleteBrand } from "@workspace/service/local/delete-brand";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createBrand,
	createCitation,
	createCompetitor,
	createPrompt,
	createRun,
	deleteBrand as deleteFixtureBrand,
	rebuildRollups,
} from "@/test/integration/stats-fixtures";

async function seedTrackedBrand() {
	const brandId = await createBrand();
	const promptId = await createPrompt(brandId);
	await createCompetitor(brandId, "Rival");
	const run = await createRun(brandId, promptId, { at: "2026-03-02T12:00:00Z", brandMentioned: true });
	await createCitation(run, "https://example.com/page");
	await rebuildRollups(brandId);
	return brandId;
}

async function rowsFor(brandId: string) {
	const tables = { brands, prompts, competitors, promptRuns, citations, rollupPromptRuns, rollupCitationPages };
	const counts: Record<string, number> = {};
	for (const [name, table] of Object.entries(tables)) {
		const column = "brandId" in table ? table.brandId : brands.id;
		const [row] = await db.select({ n: count() }).from(table).where(eq(column, brandId));
		counts[name] = row.n;
	}
	return counts;
}

let doomed: string;
let kept: string;

beforeAll(async () => {
	doomed = await seedTrackedBrand();
	kept = await seedTrackedBrand();
});

afterAll(async () => {
	await deleteFixtureBrand(kept);
});

describe("deleteBrand", () => {
	it("removes a tracked brand and everything recorded for it", async () => {
		expect(await deleteBrand(doomed)).toBe(true);
		expect(Object.values(await rowsFor(doomed)).every((n) => n === 0)).toBe(true);
	});

	it("leaves other brands untouched", async () => {
		expect(Object.values(await rowsFor(kept)).every((n) => n > 0)).toBe(true);
	});

	it("reports a brand that doesn't exist", async () => {
		expect(await deleteBrand("no-such-brand")).toBe(false);
	});
});
