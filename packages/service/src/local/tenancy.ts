import { db } from "@workspace/lib/db/db";
import { currentTenantScope, runInTenantScope, runOutsideTenantScope } from "@workspace/lib/db/tenant-pool";

export type TenantDb = typeof db;

/**
 * Runs `fn` with every query on `db` (and every transaction opened on it) seeing and
 * writing only this subject's rows. Each query outside a transaction commits on its
 * own, so a job can wait on a provider without holding one open.
 */
export async function withSubject<T>(subjectId: string, fn: (db: TenantDb) => Promise<T>): Promise<T> {
	if (!subjectId) throw new Error("withSubject needs a subject id");
	return runInTenantScope({ role: "visibility_subject", subjectId }, () => fn(db));
}

export type AgencyAccess = {
	/** Who is reading across subjects: a staff email, an API key, or a job name. */
	actor: string;
	reason: string;
};

/**
 * Runs `fn` with access to every subject, after recording the access in
 * `agency_access_log`: one row per call, however many queries `fn` makes. Inside
 * another agency scope it joins that one, which is already recorded.
 */
export async function withAgency<T>(access: AgencyAccess, fn: (db: TenantDb) => Promise<T>): Promise<T> {
	if (!access.actor || !access.reason) throw new Error("withAgency needs an actor and a reason");
	if (currentTenantScope()?.role === "visibility_agency") return fn(db);
	return runInTenantScope({ role: "visibility_agency" }, async () => {
		await db.$client.query("INSERT INTO agency_access_log (actor, reason) VALUES ($1, $2)", [
			access.actor,
			access.reason,
		]);
		return fn(db);
	});
}

type ConnectedRole = {
	name: string;
	superuser: boolean;
	bypass_rls: boolean;
	owns_tables: boolean;
	inherits_tenancy: boolean;
};

export class UnsafeAppRoleError extends Error {
	override name = "UnsafeAppRoleError";
}

/**
 * Refuses to serve as the table owner or any role that gets past row-level
 * security. The web app and worker call it before doing anything else.
 */
export async function assertAppRole(): Promise<void> {
	const { rows } = await runOutsideTenantScope(() =>
		db.$client.query<ConnectedRole>(`
			SELECT r.rolname AS name, r.rolsuper AS superuser, r.rolbypassrls AS bypass_rls,
				EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user) AS owns_tables,
				pg_has_role(current_user, 'visibility_subject', 'USAGE')
					OR pg_has_role(current_user, 'visibility_agency', 'USAGE') AS inherits_tenancy
			FROM pg_roles r WHERE r.rolname = current_user
		`),
	);
	const role = rows[0];
	if (!role) throw new Error("Couldn't read the role this app connects to Postgres as");
	const problems = [
		role.superuser && "is a superuser",
		role.bypass_rls && "bypasses row-level security",
		role.owns_tables && "owns the tables",
		role.inherits_tenancy && "inherits a tenancy role",
	].filter(Boolean);
	if (problems.length === 0) return;
	throw new UnsafeAppRoleError(
		`The app connects to Postgres as ${role.name}, which ${problems.join(" and ")}. Point DATABASE_URL at the visibility_app login role, and MIGRATION_DATABASE_URL at the owner for migrations.`,
	);
}
