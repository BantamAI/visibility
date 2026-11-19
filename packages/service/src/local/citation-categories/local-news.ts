import { cleanAndValidateDomain, inDomainSet } from "@workspace/lib/citations/domain-categories";
import { classifyPage } from "@workspace/lib/citations/page-classification";
import { db } from "@workspace/lib/db/db";
import { citedPages } from "@workspace/lib/db/schema";
import { CLASSIFIER_VERSION, updatePageCopies } from "@workspace/lib/rollups";
import { asc, eq, like, or, sql } from "drizzle-orm";
import { type LocalNewsSource, localNewsSources } from "../schema";

export class LocalNewsError extends Error {
	override name = "LocalNewsError";
}

let localNewsDomains = new Set<string>();

export function isLocalNews(domain: string): boolean {
	return inDomainSet(domain, localNewsDomains);
}

/** Reads the list into this process, which classifies with it from then on. Needs agency access. */
export async function loadLocalNewsDomains(): Promise<number> {
	const rows = await db.selectDistinct({ domain: localNewsSources.domain }).from(localNewsSources);
	localNewsDomains = new Set(rows.map((row) => row.domain));
	return localNewsDomains.size;
}

export interface MetroNewsSources {
	metro: string;
	sources: Pick<LocalNewsSource, "id" | "domain" | "addedBy" | "createdAt">[];
}

export async function listLocalNewsSources(): Promise<MetroNewsSources[]> {
	const rows = await db
		.select()
		.from(localNewsSources)
		.orderBy(asc(localNewsSources.metro), asc(localNewsSources.domain));
	const byMetro = new Map<string, MetroNewsSources>();
	for (const { id, metro, domain, addedBy, createdAt } of rows) {
		const key = metro.toLowerCase();
		const group = byMetro.get(key) ?? { metro, sources: [] };
		group.sources.push({ id, domain, addedBy, createdAt });
		byMetro.set(key, group);
	}
	return [...byMetro.values()];
}

const MAX_METRO_LENGTH = 80;

export async function addLocalNewsSource(metroInput: string, domainInput: string, addedBy: string): Promise<void> {
	const metro = metroInput.trim().replace(/\s+/g, " ");
	if (!metro) throw new LocalNewsError("Enter a metro, such as Houston, TX");
	if (metro.length > MAX_METRO_LENGTH) throw new LocalNewsError(`Keep a metro under ${MAX_METRO_LENGTH} characters`);
	const domain = cleanAndValidateDomain(domainInput);
	if (!domain) throw new LocalNewsError(`"${domainInput.trim()}" isn't a domain`);
	const [added] = await db
		.insert(localNewsSources)
		.values({ metro, domain, addedBy })
		.onConflictDoNothing()
		.returning({ id: localNewsSources.id });
	if (!added) throw new LocalNewsError(`${domain} is already listed for ${metro}`);
	await reclassifyDomain(domain);
}

export async function removeLocalNewsSource(id: string): Promise<boolean> {
	const [removed] = await db
		.delete(localNewsSources)
		.where(eq(localNewsSources.id, id))
		.returning({ domain: localNewsSources.domain });
	if (!removed) return false;
	await reclassifyDomain(removed.domain);
	return true;
}

const CHUNK = 1000;

/**
 * Brings the domain's cited pages, and every brand's copies of them, in line with the list
 * as it now stands. Locks pages in the order rollup rebuilds do, so the two can't deadlock.
 */
async function reclassifyDomain(domain: string): Promise<number> {
	await loadLocalNewsDomains();
	const pages = await db
		.select({ id: citedPages.id, url: citedPages.url, domain: citedPages.domain, title: citedPages.title })
		.from(citedPages)
		.where(or(eq(citedPages.domain, domain), like(citedPages.domain, `%.${domain}`)))
		.orderBy(sql`${citedPages.url} COLLATE "C"`);
	let updated = 0;
	for (let start = 0; start < pages.length; start += CHUNK) {
		const chunk = pages.slice(start, start + CHUNK);
		const values = chunk.map((page) => {
			const { pageType, staticCategory } = classifyPage(page.url, page.domain, page.title);
			return sql`(${page.id}::bigint, ${pageType}::text, ${staticCategory}::text)`;
		});
		const ids = sql.join(
			chunk.map((page) => sql`${page.id}::bigint`),
			sql`, `,
		);
		updated += await db.transaction(async (tx) => {
			await tx.execute(
				sql`SELECT 1 FROM ${citedPages} WHERE id IN (${ids}) ORDER BY url COLLATE "C" FOR NO KEY UPDATE`,
			);
			const result = await tx.execute(sql`
				UPDATE ${citedPages} AS p
				SET page_type = v.page_type, static_category = v.static_category, classifier_version = ${CLASSIFIER_VERSION}
				FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, page_type, static_category)
				WHERE p.id = v.id
			`);
			await updatePageCopies(
				tx,
				chunk.map((page) => page.id),
			);
			return result.rowCount ?? 0;
		});
	}
	return updated;
}
