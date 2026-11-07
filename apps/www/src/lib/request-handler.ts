import { isMarkdownPreferred, rewritePath } from "fumadocs-core/negotiation";
import { withFrontmatter } from "@/lib/frontmatter";
import { MARKDOWN_CONTENT_TYPE, markdownNotFound } from "@/lib/get-llm-text";
import { htmlToMarkdown } from "@/lib/html-to-markdown";
import { llmsTxt } from "@/lib/llms-txt";
import { markdownCopyPath } from "@/lib/markdown-copy";
import { canonicalUrl, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/seo";

const SECURITY_HEADERS: Record<string, string> = {
	"Content-Security-Policy": [
		"default-src 'self'",
		"script-src 'self' 'unsafe-inline'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: https:",
		"font-src 'self' data:",
		"connect-src 'self'",
		"object-src 'none'",
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"form-action 'self'",
	].join("; "),
	"X-Frame-Options": "DENY",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
};

function addSecurityHeaders(response: Response): Response {
	for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
		response.headers.set(key, value);
	}
	return response;
}

const DISCOVERY_LINKS = [
	`</api/openapi.json>; rel="service-desc"`,
	`</docs>; rel="service-doc"; type="text/html"`,
	`</llms.txt>; rel="describedby"; type="text/plain"`,
	`</sitemap.xml>; rel="sitemap"; type="application/xml"`,
].join(", ");

const FILE_LIKE = /\.[^/]+$/;

function addDiscoveryLinks(response: Response, path: string, markdownCopyOf?: string): void {
	const type = response.headers.get("Content-Type") ?? "";
	if (!type.startsWith("text/html") && !type.startsWith("text/markdown")) return;
	const links = [DISCOVERY_LINKS];
	if (response.ok && !FILE_LIKE.test(path)) {
		links.push(`<${markdownCopyPath(path)}>; rel="alternate"; type="text/markdown"`);
	}
	// Search engines crawl the .md copies (docs pages link to them), so point
	// them at the HTML page instead of indexing a duplicate.
	if (response.ok && markdownCopyOf) links.push(`<${canonicalUrl(markdownCopyOf)}>; rel="canonical"`);
	response.headers.set("Link", links.join(", "));
}

const MARKDOWN_SOURCES = [{ base: "/docs", indexIsPage: true }].map(({ base, indexIsPage }) => ({
	base,
	indexIsPage,
	stripMd: rewritePath(`${base}{/*path}.md`, `/llms.mdx${base}{/*path}`).rewrite,
	stripMdx: rewritePath(`${base}{/*path}.mdx`, `/llms.mdx${base}{/*path}`).rewrite,
	toMarkdown: rewritePath(`${base}{/*path}`, `/llms.mdx${base}{/*path}`).rewrite,
}));

function suffixedMarkdownRoute(path: string): string | undefined {
	for (const { base, indexIsPage, stripMd, stripMdx } of MARKDOWN_SOURCES) {
		if (!indexIsPage && (path === `${base}.md` || path === `${base}.mdx`)) continue;
		const target = stripMd(path) || stripMdx(path);
		if (target) return target;
	}
}

function negotiableMarkdownRoute(path: string): string | undefined {
	for (const { base, indexIsPage, toMarkdown } of MARKDOWN_SOURCES) {
		if (path === base && !indexIsPage) continue;
		if (path !== base && !path.startsWith(`${base}/`)) continue;
		const target = toMarkdown(path);
		if (target) return target;
	}
}

function pageBehindMarkdownSuffix(path: string): string | undefined {
	const page = path.match(/^(.*)\.mdx?$/)?.[1];
	if (page === undefined) return undefined;
	return page === "/index" ? "/" : page;
}

// Keep permanent redirects server-side so backlinks and ranking signals reach
// the canonical replacement rather than a client-rendered not-found page.
const PERMANENT_REDIRECTS: Record<string, string> = {
	"/docs/mcp": "/docs/api/mcp",
};

function redirectFor(url: URL): Response | undefined {
	const movedTo = PERMANENT_REDIRECTS[url.pathname.replace(/\/+$/, "") || "/"];
	if (movedTo) return new Response(null, { status: 308, headers: { Location: `${movedTo}${url.search}` } });
}

const MARKDOWN_MEDIA_TYPES = ["text/markdown", "text/x-markdown"];

type Upstream = (request: Request) => Response | Promise<Response>;

function at(request: Request, path: string, init?: RequestInit): Request {
	const url = new URL(request.url);
	url.pathname = path;
	return new Request(url, init ?? request);
}

function withoutBodyForHead(request: Request, response: Response): Response {
	return request.method === "HEAD" ? new Response(null, response) : response;
}

/** Pages outside the MDX sources have no markdown twin, so their rendered HTML is
 * converted instead. */
async function renderAsMarkdown(upstream: Upstream, request: Request, path: string): Promise<Response> {
	// llms.txt is the site overview the homepage's marketing layout converts poorly into.
	if (path === "/") {
		const markdown = withFrontmatter(llmsTxt, {
			title: SITE_NAME,
			description: SITE_DESCRIPTION,
			canonical: `${SITE_URL}/`,
		});
		return withoutBodyForHead(request, new Response(markdown, { headers: { "Content-Type": MARKDOWN_CONTENT_TYPE } }));
	}

	const headers = new Headers(request.headers);
	headers.set("Accept", "text/html");
	const page = at(request, path, { method: "GET", headers, signal: request.signal });
	const response = await upstream(page);

	if (response.status === 404) return withoutBodyForHead(request, markdownNotFound());
	if (!response.ok || !response.headers.get("Content-Type")?.startsWith("text/html")) return response;

	const markdown = htmlToMarkdown(await response.text(), page.url);
	return withoutBodyForHead(request, new Response(markdown, { headers: { "Content-Type": MARKDOWN_CONTENT_TYPE } }));
}

/** `routedMarkdown` lists the `.md` paths that are routes of their own; any
 * other `.md` path is the markdown twin of the page without the suffix. */
export function createRequestHandler(upstream: Upstream, routedMarkdown: ReadonlySet<string> = new Set()) {
	function respond(request: Request, path: string, isReadable: boolean, wantsMarkdown: boolean) {
		const twin = suffixedMarkdownRoute(path) ?? (wantsMarkdown ? negotiableMarkdownRoute(path) : undefined);
		if (twin) return upstream(at(request, twin));
		if (wantsMarkdown) return renderAsMarkdown(upstream, request, path);

		const page = isReadable ? markdownCopyOf(path) : undefined;
		return page ? renderAsMarkdown(upstream, request, page) : upstream(request);
	}

	function markdownCopyOf(path: string): string | undefined {
		return routedMarkdown.has(path) ? undefined : pageBehindMarkdownSuffix(path);
	}

	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		const redirect = redirectFor(url);
		if (redirect) return addSecurityHeaders(redirect);

		const path = url.pathname;
		const isReadable = request.method === "GET" || request.method === "HEAD";
		const isPage = isReadable && !FILE_LIKE.test(path);
		const wantsMarkdown = isPage && isMarkdownPreferred(request, { markdownMediaTypes: MARKDOWN_MEDIA_TYPES });

		const response = await respond(request, path, isReadable, wantsMarkdown);
		if (isPage) response.headers.set("Vary", "Accept");
		addDiscoveryLinks(response, path, isReadable ? markdownCopyOf(path) : undefined);
		return addSecurityHeaders(response);
	};
}
