import { inDomainSet } from "@workspace/lib/citations/domain-categories";

/** Directories where every page is a business listing or a list of them. */
const LISTING_DOMAINS = new Set([
	"yelp.com",
	"angi.com",
	"angieslist.com",
	"bbb.org",
	"nextdoor.com",
	"homeadvisor.com",
	"thumbtack.com",
	"maps.apple.com",
	"bingplaces.com",
	"business.google.com",
	"g.page",
	"maps.app.goo.gl",
]);

const GOOGLE_HOST_RE = /^(maps\.)?google\.[a-z.]+$/;
const GOOGLE_LISTING_PATH_RE = /^\/(maps|localservices)(\/|$)/;
const FACEBOOK_HOST_RE = /^(m\.|web\.)?facebook\.com$/;

/** First path segments that are Facebook's own features rather than a page's username. */
const FACEBOOK_NON_PAGE_ROOTS = new Set([
	"groups",
	"events",
	"watch",
	"reel",
	"reels",
	"stories",
	"story.php",
	"permalink.php",
	"photo",
	"photo.php",
	"photos",
	"video.php",
	"videos",
	"share",
	"sharer",
	"sharer.php",
	"marketplace",
	"hashtag",
	"gaming",
	"help",
	"business",
	"policies",
	"privacy",
	"legal",
	"login",
	"login.php",
	"search",
	"notes",
	"media",
	"people",
	"public",
	"l.php",
	"dialog",
	"plugins",
	"ads",
]);

/** Second segments under a page that are one post or upload, not the page. */
const FACEBOOK_POST_SEGMENTS = new Set([
	"posts",
	"videos",
	"photos",
	"photo",
	"photo.php",
	"reel",
	"reels",
	"permalink",
	"story",
]);

function isFacebookPage(path: string[]): boolean {
	const [root, next] = path;
	if (!root || FACEBOOK_NON_PAGE_ROOTS.has(root)) return false;
	if (root === "pages" || root === "profile.php") return true;
	return !next || !FACEBOOK_POST_SEGMENTS.has(next);
}

/**
 * Business listings: Google Maps and Business Profile links, the directories local answers
 * draw on, and Facebook pages (a page's posts and groups stay social). With no URL, only
 * the directories can be told apart.
 */
export function isListing(domain: string, url: string | null): boolean {
	if (inDomainSet(domain, LISTING_DOMAINS)) return true;
	if (!url) return false;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
	const path = parsed.pathname.toLowerCase();
	if (GOOGLE_HOST_RE.test(host)) return host.startsWith("maps.") || GOOGLE_LISTING_PATH_RE.test(path);
	if (host === "goo.gl") return path.startsWith("/maps");
	if (host === "bing.com") return /^\/maps(\/|$)/.test(path);
	if (FACEBOOK_HOST_RE.test(host)) return isFacebookPage(path.split("/").filter(Boolean));
	return false;
}
