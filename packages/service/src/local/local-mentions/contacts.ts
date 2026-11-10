import { db } from "@workspace/lib/db/db";
import { competitors } from "@workspace/lib/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { e164 } from "../answer-businesses/card";
import { type BusinessContact, businessContacts } from "../schema";

export class BusinessContactError extends Error {
	override name = "BusinessContactError";
}

export function listContacts(subjectId: string): Promise<BusinessContact[]> {
	return db.select().from(businessContacts).where(eq(businessContacts.subjectId, subjectId));
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Records the phone and address of the subject, or one of its tracked competitors, as staff know
 * them. Clearing both removes the record.
 */
export async function saveContact(
	subjectId: string,
	input: { competitorName: string | null; phone: string; address: string; updatedBy: string },
): Promise<BusinessContact | null> {
	const phone = input.phone.trim() ? e164(input.phone) : null;
	if (input.phone.trim() && !phone)
		throw new BusinessContactError("Enter the phone number with its area code, or with + and its country code");
	const address = input.address.trim() || null;
	let competitorName: string | null = null;
	if (input.competitorName !== null) {
		const wanted = input.competitorName;
		const tracked = await db
			.select({ name: competitors.name })
			.from(competitors)
			.where(eq(competitors.brandId, subjectId));
		const match = tracked.find(({ name }) => sameName(name, wanted));
		if (!match) throw new BusinessContactError(`"${wanted}" isn't a tracked competitor`);
		competitorName = match.name;
	}
	return db.transaction(async (tx) => {
		await tx
			.delete(businessContacts)
			.where(
				and(
					eq(businessContacts.subjectId, subjectId),
					competitorName === null
						? isNull(businessContacts.competitorName)
						: sql`lower(${businessContacts.competitorName}) = lower(${competitorName})`,
				),
			);
		if (!phone && !address) return null;
		const [contact] = await tx
			.insert(businessContacts)
			.values({ subjectId, competitorName, phone, address, updatedBy: input.updatedBy })
			.returning();
		return contact;
	});
}
