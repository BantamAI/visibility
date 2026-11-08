import { AsyncLocalStorage } from "node:async_hooks";
import pg from "pg";

/**
 * Who the current async call chain acts for (E53-S37). Set by withSubject() and
 * withAgency() in @workspace/service/local/tenancy; this file sits in lib only
 * because the shared `db` is built here.
 */
export type TenantScope = { role: "visibility_subject"; subjectId: string } | { role: "visibility_agency" };

const scopes = new AsyncLocalStorage<TenantScope>();

export function currentTenantScope(): TenantScope | undefined {
	return scopes.getStore();
}

// Both await `fn` inside the scope: a drizzle query is a thenable that only runs once
// awaited, which would otherwise happen after the scope had ended.
export function runInTenantScope<T>(scope: TenantScope, fn: () => T | PromiseLike<T>): Promise<T> {
	return scopes.run(scope, async () => await fn());
}

export function runOutsideTenantScope<T>(fn: () => T | PromiseLike<T>): Promise<T> {
	return scopes.exit(async () => await fn());
}

const APPLY_SCOPE = "SELECT set_config('role', $1, false), set_config('app.subject_id', $2, false)";
const CLEAR_SCOPE = "RESET ROLE; RESET app.subject_id";

/**
 * A pool that switches every connection it lends to the caller's tenant scope and
 * switches it back before the connection is reused. Outside a scope it lends the
 * login role as is, which reaches no subject rows.
 */
export class TenantPool extends pg.Pool {
	constructor(config?: pg.PoolConfig) {
		super(config);
		const unscoped = pg.Pool.prototype.query;
		// Assigned rather than overridden, so the pool keeps pg's query overloads.
		this.query = ((...args: unknown[]) => {
			const scope = scopes.getStore();
			if (!scope || typeof args.at(-1) === "function") return Reflect.apply(unscoped, this, args);
			return this.queryInScope(scope, args);
		}) as pg.Pool["query"];
	}

	override connect(): Promise<pg.PoolClient>;
	override connect(
		callback: (err: Error | undefined, client: pg.PoolClient | undefined, done: (release?: unknown) => void) => void,
	): void;
	override connect(
		callback?: (err: Error | undefined, client: pg.PoolClient | undefined, done: (release?: unknown) => void) => void,
	): Promise<pg.PoolClient> | undefined {
		// pg.Pool's own query() connects with a callback; it only runs unscoped (see query below).
		if (callback) {
			super.connect(callback);
			return;
		}
		const scope = scopes.getStore();
		return scope ? this.connectInScope(scope) : super.connect();
	}

	private async queryInScope(scope: TenantScope, args: unknown[]): Promise<pg.QueryResult> {
		const client = await this.connectInScope(scope);
		let result: pg.QueryResult;
		try {
			result = await (Reflect.apply(client.query, client, args) as Promise<pg.QueryResult>);
		} catch (error) {
			// Like pg.Pool.query: a connection that failed a query isn't trusted again.
			client.release(error as Error);
			throw error;
		}
		client.release();
		return result;
	}

	private async connectInScope(scope: TenantScope): Promise<pg.PoolClient> {
		const client = await super.connect();
		const subjectId = scope.role === "visibility_subject" ? scope.subjectId : "";
		try {
			await client.query(APPLY_SCOPE, [scope.role, subjectId]);
		} catch (error) {
			client.release(error as Error);
			throw error;
		}
		const release = client.release;
		client.release = (err?: Error | boolean) => {
			if (err) return release(err);
			client.query(CLEAR_SCOPE).then(
				() => release(),
				(clearError: Error) => release(clearError),
			);
		};
		return client;
	}
}
