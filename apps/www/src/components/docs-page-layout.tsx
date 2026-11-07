// All fumadocs-ui / docs UI imports live here, NOT in routes/docs/$.tsx.
// $.tsx and index.tsx only reference DocsPageLayout from inside the route's
// `component:`, which @tanstack/router-plugin auto-splits into its own chunk.
// The static imports below get hoisted into that chunk, so the heavy
// fumadocs-ui + shiki + orama deps stay out of the main bundle that loads
// on the marketing pages.

import { DocsSidebar } from "@workspace/docs/components/docs-sidebar";
import { DocsToc } from "@workspace/docs/components/docs-toc";
import browserCollections from "collections/browser";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import type { OpenAPIPageProps } from "fumadocs-openapi/ui";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import { Suspense } from "react";
import { OpenAPIPage } from "@/components/api-page";
import { Footer } from "@/components/footer";
import { useMDXComponents } from "@/components/mdx";
import { Navbar } from "@/components/navbar";
import type { LoaderData } from "@/routes/docs/$";

// /docs/foo → /docs/foo.md  (/docs index → /docs.md). The same markdown the
// .md/.mdx routes and the Accept-header negotiation serve (see request-handler.ts).
function docsMarkdownPath(slugs: string[]): string {
	return slugs.length ? `/docs/${slugs.join("/")}.md` : "/docs.md";
}

/**
 * The rendered page body. Its own component so useMDXComponents runs at the
 * top level of one, rather than inside the loader's render callback.
 */
function DocsArticle({
	title,
	description,
	MDX,
}: {
	title: string;
	description?: string;
	MDX: React.FC<{ components: ReturnType<typeof useMDXComponents> }>;
}) {
	return (
		<article className="prose prose-zinc min-w-0 max-w-none flex-1">
			<h1>{title}</h1>
			{description && <p className="lead text-muted-foreground">{description}</p>}
			<MDX components={useMDXComponents()} />
		</article>
	);
}

const clientLoader = browserCollections.docs.createClientLoader({
	component({ toc, frontmatter, default: MDX }, _props: undefined) {
		return (
			<div className="flex gap-10">
				<DocsArticle title={frontmatter.title} description={frontmatter.description} MDX={MDX} />

				{toc.length > 0 && (
					<aside className="hidden w-48 shrink-0 lg:block">
						<div className="sticky top-20">
							<DocsToc toc={toc} />
						</div>
					</aside>
				)}
			</div>
		);
	},
});

function DocsPageActions({ mdUrl }: { mdUrl: string }) {
	return (
		<div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4 text-sm text-muted-foreground">
			<a
				href={mdUrl}
				target="_blank"
				rel="noopener"
				className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
			>
				<svg
					aria-hidden="true"
					className="size-3.5"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
					<path d="M14 2v5h5" />
					<path d="M9 13h6" />
					<path d="M9 17h6" />
				</svg>
				View as Markdown
			</a>
		</div>
	);
}

function OpenApiContent({ title, apiProps }: { title: string; apiProps: OpenAPIPageProps }) {
	return (
		<article className="prose prose-zinc min-w-0 max-w-none flex-1">
			<h1>{title}</h1>
			<OpenAPIPage {...apiProps} />
		</article>
	);
}

/**
 * The MDX page for a path. Wrapping useContent in a component keeps the hook
 * out of the branch that chooses between MDX and the OpenAPI renderer.
 */
function MdxContent({ path }: { path: string }) {
	return clientLoader.useContent(path);
}

export function DocsPageLayout({ loaderData }: { loaderData: LoaderData }) {
	const data = useFumadocsLoader(loaderData);

	return (
		<RootProvider theme={{ defaultTheme: "light", forcedTheme: "light" }} search={{ enabled: false }}>
			<div className="min-h-screen">
				<Navbar />
				<div className="mx-auto max-w-6xl px-4 py-8 md:px-6 lg:px-8">
					<div className="flex gap-10">
						<aside className="hidden w-56 shrink-0 md:block">
							<div className="sticky top-20">
								<DocsSidebar tree={data.pageTree} />
							</div>
						</aside>

						<main className="min-w-0 flex-1">
							{data.type === "openapi" ? (
								<OpenApiContent title={data.title} apiProps={data.apiProps} />
							) : (
								<>
									<Suspense>
										<MdxContent path={data.path} />
									</Suspense>
									<DocsPageActions mdUrl={docsMarkdownPath(data.slugs)} />
								</>
							)}
						</main>
					</div>
				</div>
				<Footer />
			</div>
		</RootProvider>
	);
}
