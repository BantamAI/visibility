import { brands, competitors, organization } from "@workspace/lib/db/schema";
import { createOwnerDb } from "@workspace/lib/test/integration/owner-db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withSubject } from "../tenancy";
import { listContacts, saveContact } from "./contacts";

const ORG = "contacts-test-org";
const A = "contacts-test-a";

const owner = createOwnerDb();

const save = (competitorName: string | null, phone: string, address = "") =>
	withSubject(A, () => saveContact(A, { competitorName, phone, address, updatedBy: "staff@example.com" }));

beforeAll(async () => {
	await cleanUp();
	await owner.insert(organization).values({ id: ORG, name: "Contacts Test", slug: ORG, createdAt: new Date() });
	await owner
		.insert(brands)
		.values({ id: A, name: "Oak City Plumbing", website: "https://oak.example", organizationId: ORG });
	await owner.insert(competitors).values({ brandId: A, name: "Triangle Rooter" });
});

afterAll(async () => {
	await cleanUp();
	await owner.$client.end();
});

async function cleanUp() {
	await owner.delete(competitors).where(eq(competitors.brandId, A));
	await owner.delete(brands).where(eq(brands.id, A));
	await owner.delete(organization).where(eq(organization.id, ORG));
}

describe("business contacts", () => {
	it("stores a phone as E.164, and a competitor's under its tracked name", async () => {
		await save(null, "(919) 555-0100", " 1 Main St, Raleigh, NC ");
		await save("triangle rooter", "919.555.0200");
		const contacts = await withSubject(A, () => listContacts(A));
		expect(contacts.map(({ competitorName, phone, address }) => ({ competitorName, phone, address }))).toEqual(
			expect.arrayContaining([
				{ competitorName: null, phone: "+19195550100", address: "1 Main St, Raleigh, NC" },
				{ competitorName: "Triangle Rooter", phone: "+19195550200", address: null },
			]),
		);
	});

	it("replaces a business's contact, and clearing both fields removes it", async () => {
		await save(null, "+1 919 555 0111");
		expect((await withSubject(A, () => listContacts(A))).find((c) => c.competitorName === null)?.phone).toBe(
			"+19195550111",
		);
		await save(null, "");
		expect((await withSubject(A, () => listContacts(A))).some((c) => c.competitorName === null)).toBe(false);
	});

	it("refuses a phone it can't read, and a competitor that isn't tracked", async () => {
		await expect(save(null, "555-0100")).rejects.toThrow(/area code/);
		await expect(save("Nobody Plumbing", "(919) 555-0100")).rejects.toThrow(/isn't a tracked competitor/);
	});
});
