import { pageSchema } from "fumadocs-core/source/schema";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { z } from "zod";

const frontmatterDate = z
	.union([z.string(), z.date()])
	.transform((value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value));

export const docs = defineDocs({
	dir: "../../packages/docs/content/docs",
	docs: {
		schema: pageSchema.extend({
			// Bump on a substantive edit: it is the page's sitemap lastmod and JSON-LD dateModified.
			updated: frontmatterDate.optional(),
		}),
		postprocess: {
			includeProcessedMarkdown: true,
		},
	},
});

export default defineConfig();
