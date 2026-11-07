import { createFileRoute } from "@tanstack/react-router";
import { newest, pageLastUpdated } from "@/lib/page-dates";
import { SITE_URL } from "@/lib/seo";
import { source } from "@/lib/source";

interface SitemapEntry {
	path: string;
	changefreq: string;
	priority: number;
	/**
	 * W3C date (YYYY-MM-DD). Only set when we have a real per-page date. A faked
	 * uniform lastmod (e.g. "today" on every URL) is an unreliable signal that
	 * Google discards, so pages without a genuine date omit it entirely.
	 */
	lastmod?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
	server: {
		handlers: {
			GET: async () => {
				const docsPages: SitemapEntry[] = source.getPages().map((page) => ({
					path: page.url,
					changefreq: "weekly",
					priority: 0.7,
					lastmod: pageLastUpdated(page),
				}));

				const allPages: SitemapEntry[] = [
					{
						path: "/docs",
						changefreq: "weekly",
						priority: 0.9,
						lastmod: newest(docsPages.map((page) => page.lastmod)),
					},
					...docsPages.filter((page) => page.path !== "/docs"),
				];

				const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allPages
	.map(
		(page) => `  <url>
    <loc>${SITE_URL}${page.path}</loc>${page.lastmod ? `\n    <lastmod>${page.lastmod}</lastmod>` : ""}
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`,
	)
	.join("\n")}
</urlset>`;

				return new Response(sitemap, {
					headers: { "Content-Type": "application/xml" },
				});
			},
		},
	},
});
