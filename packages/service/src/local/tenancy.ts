import { db } from "@workspace/lib/db/db";
import { sql } from "drizzle-orm";

export type TenantTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Runs `fn` in a transaction that sees and writes only this subject's rows. */
export async function withSubject<T>(subjectId: string, fn: (tx: TenantTransaction) => Promise<T>): Promise<T> {
	if (!subjectId) throw new Error("withSubject needs a subject id");
	return db.transaction(async (tx) => {
		await tx.execute(sql`SELECT set_config('app.subject_id', ${subjectId}, true)`);
		await tx.execute(sql`SET LOCAL ROLE visibility_subject`);
		return fn(tx);
	});
}

export type AgencyAccess = {
	/** Who is reading across subjects: a staff email, or a job name. */
	actor: string;
	reason: string;
};

/** Runs `fn` in a transaction that sees every subject, after recording the access in `agency_access_log`. */
export async function withAgency<T>(access: AgencyAccess, fn: (tx: TenantTransaction) => Promise<T>): Promise<T> {
	if (!access.actor || !access.reason) throw new Error("withAgency needs an actor and a reason");
	return db.transaction(async (tx) => {
		await tx.execute(sql`SET LOCAL ROLE visibility_agency`);
		await tx.execute(sql`INSERT INTO agency_access_log (actor, reason) VALUES (${access.actor}, ${access.reason})`);
		return fn(tx);
	});
}
