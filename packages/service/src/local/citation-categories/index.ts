import { setCitationCategoryOverride } from "@workspace/lib/citations/domain-lists";
import { isListing } from "./listings";
import { isLocalNews } from "./local-news";

/**
 * Puts listings and local news ahead of Elmo's curated lists in this process. Call it before
 * anything classifies a citation, and load the local news list (`loadLocalNewsDomains`) too.
 */
export function installLocalCitationCategories(): void {
	setCitationCategoryOverride((domain, url) => {
		if (isListing(domain, url)) return "listings";
		if (isLocalNews(domain)) return "local-news";
		return null;
	});
}

export { isListing } from "./listings";
export {
	addLocalNewsSource,
	isLocalNews,
	LocalNewsError,
	listLocalNewsSources,
	loadLocalNewsDomains,
	type MetroNewsSources,
	removeLocalNewsSource,
} from "./local-news";
