import { db } from "@workspace/lib/db/db";
import { brands, competitors, organization, prompts } from "@workspace/lib/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withAgency, withSubject } from "./tenancy";

const ORG = "tenancy-test-org";
const A = "tenancy-test-a";
const B = "tenancy-test-b";

beforeAll(async () => {
	await cleanUp();
	await db.insert(organization).values({ id: ORG, name: "Tenancy Test", slug: ORG, createdAt: new Date() });
	await db.insert(brands).values([
		{ id: A, name: "Subject A", website: "https://a.example", organizationId: ORG },
		{ id: B, name: "Subject B", website: "https://b.example", organizationId: ORG },
	]);
	await db.insert(prompts).values([
		{ brandId: A, value: "prompt a" },
		{ brandId: B, value: "prompt b" },
	]);
});

afterAll(async () => {
	await cleanUp();
	await db.$client.end();
});

async function cleanUp() {
	await db.delete(prompts).where(inArray(prompts.brandId, [A, B]));
	await db.delete(competitors).where(inArray(competitors.brandId, [A, B]));
	await db.delete(brands).where(inArray(brands.id, [A, B]));
	await db.delete(organization).where(eq(organization.id, ORG));
}

describe("withSubject", () => {
	it("reads only the subject's rows", async () => {
		const values = await withSubject(A, (tx) => tx.select({ value: prompts.value }).from(prompts));
		expect(values).toEqual([{ value: "prompt a" }]);
	});

	it("rejects writes for another subject", async () => {
		await expect(
			withSubject(A, (tx) => tx.insert(competitors).values({ brandId: B, name: "Planted" })),
		).rejects.toThrow();
		const planted = await db.select().from(competitors).where(eq(competitors.brandId, B));
		expect(planted).toEqual([]);
	});

	it("leaves the connection unscoped afterwards", async () => {
		await withSubject(A, async () => {});
		const [setting] = (
			await db.execute<{ subject: string | null }>(sql`SELECT current_setting('app.subject_id', true) AS subject`)
		).rows;
		expect(setting?.subject || null).toBeNull();
	});

	it("refuses an empty subject id", async () => {
		await expect(withSubject("", async () => {})).rejects.toThrow();
	});
});

describe("withAgency", () => {
	it("reads across subjects and logs the access", async () => {
		const reason = `tenancy test ${Date.now()}`;
		const ids = await withAgency({ actor: "staff@example.com", reason }, (tx) =>
			tx
				.select({ id: brands.id })
				.from(brands)
				.where(inArray(brands.id, [A, B]))
				.orderBy(brands.id),
		);
		expect(ids).toEqual([{ id: A }, { id: B }]);
		const logged = await db.execute(sql`SELECT actor FROM agency_access_log WHERE reason = ${reason}`);
		expect(logged.rows).toEqual([{ actor: "staff@example.com" }]);
	});

	it("refuses access without a reason", async () => {
		await expect(withAgency({ actor: "staff@example.com", reason: "" }, async () => {})).rejects.toThrow();
	});
});
