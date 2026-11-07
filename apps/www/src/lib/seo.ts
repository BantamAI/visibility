import { DOCS_SITE_URL } from "@workspace/config/constants";
import { getMarketingOgImage } from "./og";

export const SITE_URL = DOCS_SITE_URL;
export const SITE_NAME = "ChatSpy";
// Fallback description for pages without their own, and the description on the
// WebSite/Organization/SoftwareApplication entities. Spells out "answer engine
// optimization" because answer engines expand the acronym when they search, and
// carries no pricing so it stays true wherever it is reused.
export const SITE_DESCRIPTION =
	"Open-source answer engine optimization (AEO) platform: track how AI answers mention and cite your brand.";
const SITE_LOGO_URL = `${SITE_URL}/icons/chatspy-icon-512.png`;

export function canonicalUrl(path: string): string {
	return `${SITE_URL}${path}`;
}

export function ogMeta({
	title,
	description,
	path,
	image,
	type = "website",
	label,
}: {
	title: string;
	description: string;
	path: string;
	image?: string;
	type?: "website" | "article";
	/** Section shown on the generated share image, e.g. "Blog". Ignored when `image` is given. */
	label?: string;
}) {
	const url = canonicalUrl(path);
	const resolvedImage = image ?? getMarketingOgImage({ title, description, label });
	const absoluteImage = resolvedImage.startsWith("http") ? resolvedImage : canonicalUrl(resolvedImage);

	return [
		{ property: "og:title", content: title },
		{ property: "og:description", content: description },
		{ property: "og:url", content: url },
		{ property: "og:site_name", content: SITE_NAME },
		{ property: "og:type", content: type },
		{ property: "og:locale", content: "en_US" },
		{ property: "og:image", content: absoluteImage },
		{ property: "og:image:width", content: "1200" },
		{ property: "og:image:height", content: "630" },
		{ property: "og:image:alt", content: title },
		{ name: "twitter:card", content: "summary_large_image" },
		{ name: "twitter:title", content: title },
		{ name: "twitter:description", content: description },
		{ name: "twitter:image", content: absoluteImage },
	];
}

function jsonLd(data: Record<string, unknown>): {
	type: string;
	children: string;
} {
	return {
		type: "application/ld+json",
		children: JSON.stringify({ "@context": "https://schema.org", ...data }),
	};
}

export function websiteJsonLd() {
	return jsonLd({
		"@type": "WebSite",
		name: SITE_NAME,
		url: SITE_URL,
		description: SITE_DESCRIPTION,
	});
}

export function organizationJsonLd() {
	return jsonLd({
		"@type": "Organization",
		name: SITE_NAME,
		description: SITE_DESCRIPTION,
		url: SITE_URL,
		logo: SITE_LOGO_URL,
	});
}

export function articleJsonLd({
	title,
	description,
	path,
	dateModified,
}: {
	title: string;
	description: string;
	path: string;
	dateModified?: string;
}) {
	return jsonLd({
		"@type": "TechArticle",
		headline: title,
		description,
		url: canonicalUrl(path),
		...(dateModified && { dateModified }),
		publisher: {
			"@type": "Organization",
			name: SITE_NAME,
			url: SITE_URL,
		},
	});
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
	return jsonLd({
		"@type": "BreadcrumbList",
		itemListElement: items.map((item, index) => ({
			"@type": "ListItem",
			position: index + 1,
			name: item.name,
			item: canonicalUrl(item.path),
		})),
	});
}
