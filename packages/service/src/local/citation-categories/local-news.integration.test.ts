import { setCitationCategoryOverride } from "@workspace/lib/citations/domain-lists";
import { classifyPage } from "@workspace/lib/citations/page-classification";
import { brands, citedPages, organization, rollupCitationPages } from "@workspace/lib/db/schema";
import { createOwnerDb } from "@workspace/lib/test/integration/owner-db";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localNewsSources } from "../schema";
import { withSubject } from "../tenancy";
import {
	addLocalNewsSource,
	installLocalCitationCategories,
	LocalNewsError,
	listLocalNewsSources,
	loadLocalNewsDomains,
	removeLocalNewsSource,
} from ".";

const ORG = "local-news-test-org";
const BRAND = "local-news-test-brand";
const METRO = "Testville, TX";
const DOMAIN = "testville-gazette.example";
const owner = createOwnerDb();

const PAGES = [
	{ url: `https://${DOMAIN}/2031/03/best-plumbers`, domain: DOMAIN, title: "Best plumbers in Testville" },
	{ url: `https://news.${DOMAIN}/water-main-break`, domain: `news.${DOMAIN}`, title: null },
];

beforeAll(async () => {
	await cleanUp();
	installLocalCitationCategories();
	await owner.insert(organization).values({ id: ORG, name: "Local News Test", slug: ORG, createdAt: new Date() });
	await owner.insert(brands).values({ id: BRAND, name: BRAND, website: "https://brand.example", organizationId: ORG });
	const now = new Date();
	const inserted = await owner
		.insert(citedPages)
		.values(
			PAGES.map((page) => ({
				...page,
				...classifyPage(page.url, page.domain, page.title),
				classifierVersion: 1,
				firstSeenAt: now,
				lastSeenAt: now,
			})),
		)
		.returning();
	await owner.insert(rollupCitationPages).values(
		inserted.map((page) => ({
			brandId: BRAND,
			pageId: page.id,
			url: page.url,
			domain: page.domain,
			title: page.title,
			pageType: page.pageType,
			staticCategory: page.staticCategory,
		})),
	);
});

afterAll(async () => {
	await cleanUp();
	setCitationCategoryOverride(null);
	await owner.$client.end();
});

async function cleanUp() {
	await owner.delete(localNewsSources).where(eq(localNewsSources.metro, METRO));
	await owner.delete(rollupCitationPages).where(eq(rollupCitationPages.brandId, BRAND));
	await owner.delete(citedPages).where(like(citedPages.domain, `%${DOMAIN}`));
	await owner.delete(brands).where(eq(brands.id, BRAND));
	await owner.delete(organization).where(eq(organization.id, ORG));
}

async function categories() {
	const urls = PAGES.map((page) => page.url);
	const pages = await owner
		.select({ category: citedPages.staticCategory })
		.from(citedPages)
		.where(inArray(citedPages.url, urls));
	const copies = await owner
		.select({ category: rollupCitationPages.staticCategory })
		.from(rollupCitationPages)
		.where(and(eq(rollupCitationPages.brandId, BRAND), inArray(rollupCitationPages.url, urls)));
	return new Set([...pages, ...copies].map((row) => row.category));
}

describe("local news", () => {
	it("starts from a seed list of sites per metro", async () => {
		const metros = await listLocalNewsSources();
		const houston = metros.find((group) => group.metro === "Houston, TX");
		expect(houston?.sources.map((source) => source.domain)).toContain("houstonchronicle.com");

		await loadLocalNewsDomains();
		const page = classifyPage(
			"https://houstonchronicle.com/news/houston-texas/article/123.php",
			"houstonchronicle.com",
			null,
		);
		expect(page.staticCategory).toBe("local-news");
	});

	it("reclassifies pages already cited, and every brand's copies, when a site is added and removed", async () => {
		expect(await categories()).toEqual(new Set(["editorial"]));

		await addLocalNewsSource(` ${METRO} `, `https://www.${DOMAIN}/`, "staff@example.com");
		expect(await categories()).toEqual(new Set(["local-news"]));

		const [group] = (await listLocalNewsSources()).filter((metro) => metro.metro === METRO);
		expect(group.sources).toMatchObject([{ domain: DOMAIN, addedBy: "staff@example.com" }]);

		expect(await removeLocalNewsSource(group.sources[0].id)).toBe(true);
		expect(await categories()).toEqual(new Set(["editorial"]));
	});

	it("refuses a duplicate site or something that isn't a domain", async () => {
		await addLocalNewsSource(METRO, DOMAIN, "staff@example.com");
		await expect(addLocalNewsSource(METRO.toUpperCase(), DOMAIN, "staff@example.com")).rejects.toThrow(LocalNewsError);
		await expect(addLocalNewsSource(METRO, "not a domain", "staff@example.com")).rejects.toThrow(LocalNewsError);
		await expect(addLocalNewsSource("  ", DOMAIN, "staff@example.com")).rejects.toThrow(LocalNewsError);
	});

	it("is the agency's list: subject-scoped work can't read it", async () => {
		await expect(withSubject(BRAND, () => listLocalNewsSources())).rejects.toThrow();
	});
});
