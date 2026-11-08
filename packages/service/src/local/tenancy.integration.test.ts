import { db } from "@workspace/lib/db/db";
import { brands, competitors, organization, prompts } from "@workspace/lib/db/schema";
import { runOutsideTenantScope } from "@workspace/lib/db/tenant-pool";
import { createOwnerDb } from "@workspace/lib/test/integration/owner-db";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertAppRole, withAgency, withSubject } from "./tenancy";

const ORG = "tenancy-test-org";
const A = "tenancy-test-a";
const B = "tenancy-test-b";

const owner = createOwnerDb();

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
	await owner.$client.end();
});

async function cleanUp() {
	await db.delete(prompts).where(inArray(prompts.brandId, [A, B]));
	await db.delete(competitors).where(inArray(competitors.brandId, [A, B]));
	await db.delete(brands).where(inArray(brands.id, [A, B]));
	await db.delete(organization).where(eq(organization.id, ORG));
}

const promptValues = () => db.select({ value: prompts.value }).from(prompts).orderBy(prompts.value);

async function accessLogged(reason: string): Promise<string[]> {
	const { rows } = await owner.execute<{ actor: string }>(
		sql`SELECT actor FROM agency_access_log WHERE reason = ${reason}`,
	);
	return rows.map((row) => row.actor);
}

describe("the app connection", () => {
	it("connects as a role row-level security applies to", async () => {
		await expect(assertAppRole()).resolves.toBeUndefined();
	});

	it("reaches no subject rows outside both helpers", async () => {
		await runOutsideTenantScope(async () => {
			await expect(promptValues()).rejects.toThrow();
			await expect(db.insert(competitors).values({ brandId: A, name: "Unscoped" })).rejects.toThrow();
		});
		expect(await owner.select().from(competitors).where(eq(competitors.brandId, A))).toEqual([]);
	});

	it("hands connections back as the login role", async () => {
		await Promise.all(Array.from({ length: 20 }, () => withSubject(A, () => promptValues())));
		const roles = await runOutsideTenantScope(() =>
			Promise.all(
				Array.from({ length: 20 }, () =>
					db.execute<{ role: string; subject: string | null }>(
						sql`SELECT current_user AS role, nullif(current_setting('app.subject_id', true), '') AS subject`,
					),
				),
			),
		);
		expect(new Set(roles.flatMap((result) => result.rows.map((row) => `${row.role}:${row.subject}`)))).toEqual(
			new Set(["visibility_app:null"]),
		);
	});
});

describe("withSubject", () => {
	it("reads only the subject's rows", async () => {
		expect(await withSubject(A, () => promptValues())).toEqual([{ value: "prompt a" }]);
	});

	it("rejects writes for another subject", async () => {
		await expect(
			withSubject(A, (tx) => tx.insert(competitors).values({ brandId: B, name: "Planted" })),
		).rejects.toThrow();
		expect(await db.select().from(competitors).where(eq(competitors.brandId, B))).toEqual([]);
	});

	it("scopes the transactions opened inside it", async () => {
		const values = await withSubject(B, (scoped) =>
			scoped.transaction((tx) => tx.select({ value: prompts.value }).from(prompts)),
		);
		expect(values).toEqual([{ value: "prompt b" }]);
	});

	it("keeps concurrent subjects apart", async () => {
		const [a, b] = await Promise.all([withSubject(A, () => promptValues()), withSubject(B, () => promptValues())]);
		expect([a, b]).toEqual([[{ value: "prompt a" }], [{ value: "prompt b" }]]);
	});

	it("narrows an agency scope", async () => {
		const reason = `narrowing test ${Date.now()}`;
		const values = await runOutsideTenantScope(() =>
			withAgency({ actor: "staff@example.com", reason }, () => withSubject(A, () => promptValues())),
		);
		expect(values).toEqual([{ value: "prompt a" }]);
	});

	it("refuses an empty subject id", async () => {
		await expect(withSubject("", async () => {})).rejects.toThrow();
	});
});

describe("withAgency", () => {
	it("reads across subjects and logs the access once", async () => {
		const reason = `tenancy test ${Date.now()}`;
		const values = await runOutsideTenantScope(() =>
			withAgency({ actor: "staff@example.com", reason }, async () => {
				await promptValues();
				return promptValues();
			}),
		);
		expect(values).toEqual(expect.arrayContaining([{ value: "prompt a" }, { value: "prompt b" }]));
		expect(await accessLogged(reason)).toEqual(["staff@example.com"]);
	});

	it("joins an agency scope it runs inside", async () => {
		const outer = `outer ${Date.now()}`;
		const inner = `inner ${Date.now()}`;
		await runOutsideTenantScope(() =>
			withAgency({ actor: "job", reason: outer }, () =>
				withAgency({ actor: "job", reason: inner }, () => promptValues()),
			),
		);
		expect([await accessLogged(outer), await accessLogged(inner)]).toEqual([["job"], []]);
	});

	it("can't read or erase its own log", async () => {
		await runOutsideTenantScope(() =>
			withAgency({ actor: "staff@example.com", reason: "log tamper test" }, async (scoped) => {
				await expect(scoped.execute(sql`SELECT 1 FROM agency_access_log`)).rejects.toThrow();
				await expect(scoped.execute(sql`DELETE FROM agency_access_log`)).rejects.toThrow();
			}),
		);
	});

	it("refuses access without a reason", async () => {
		await expect(withAgency({ actor: "staff@example.com", reason: "" }, async () => {})).rejects.toThrow();
	});
});
