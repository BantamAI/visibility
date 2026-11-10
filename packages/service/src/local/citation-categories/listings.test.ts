import { extractDomain } from "@workspace/lib/citations/domain-categories";
import { categorizeDomain, classifyUrl, setCitationCategoryOverride } from "@workspace/lib/citations/domain-lists";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installLocalCitationCategories } from ".";

const NONE = new Set<string>();
const category = (url: string, brandDomains = NONE) => classifyUrl(extractDomain(url), url, null, brandDomains, NONE);

beforeAll(() => installLocalCitationCategories());
afterAll(() => setCitationCategoryOverride(null));

describe("listings", () => {
	it("takes the directories local answers draw on away from reviews and social", () => {
		for (const url of [
			"https://yelp.com/biz/acme-plumbing-houston",
			"https://yelp.com/search?find_desc=plumbers&find_loc=Houston",
			"https://angi.com/companylist/us/tx/houston/acme-plumbing.htm",
			"https://bbb.org/us/tx/houston/profile/plumber/acme-plumbing-0915-123",
			"https://nextdoor.com/pages/acme-plumbing-houston-tx",
			"https://homeadvisor.com/rated.AcmePlumbing.123.html",
			"https://thumbtack.com/tx/houston/plumbers",
		]) {
			expect(category(url), url).toBe("listings");
		}
	});

	it("counts Google Maps, Business Profile, Apple Maps and Bing Maps links", () => {
		for (const url of [
			"https://google.com/maps/place/Acme+Plumbing/@29.76,-95.36,15z",
			"https://google.com/maps?cid=1234567890",
			"https://maps.google.com/?cid=1234567890",
			"https://google.co.uk/maps/place/Acme",
			"https://google.com/localservices/prolist?src=2",
			"https://maps.app.goo.gl/AbCdEf",
			"https://goo.gl/maps/AbCdEf",
			"https://g.page/acme-plumbing",
			"https://maps.apple.com/place?auid=123",
			"https://bing.com/maps?ss=ypid.YN123",
			"https://bingplaces.com",
		]) {
			expect(category(url), url).toBe("listings");
		}
	});

	it("leaves the rest of Google and Bing alone", () => {
		expect(category("https://support.google.com/business/answer/123")).not.toBe("listings");
		expect(category("https://bing.com/news/search?q=plumbers")).not.toBe("listings");
	});

	it("counts a Facebook page but leaves its posts, groups and Facebook's own pages social", () => {
		for (const url of [
			"https://facebook.com/AcmePlumbingHouston",
			"https://facebook.com/AcmePlumbingHouston/reviews",
			"https://m.facebook.com/AcmePlumbingHouston/about",
			"https://facebook.com/pages/Acme-Plumbing/123456",
			"https://facebook.com/profile.php?id=123456",
		]) {
			expect(category(url), url).toBe("listings");
		}
		for (const url of [
			"https://facebook.com",
			"https://facebook.com/AcmePlumbingHouston/posts/pfbid0abc",
			"https://facebook.com/AcmePlumbingHouston/videos/123",
			"https://facebook.com/groups/houstonhomeowners/posts/123",
			"https://facebook.com/permalink.php?story_fbid=1&id=2",
			"https://facebook.com/watch/?v=123",
			"https://facebook.com/marketplace/houston",
		]) {
			expect(category(url), url).toBe("social");
		}
	});

	it("counts a directory from its domain alone, but not a Facebook page", () => {
		expect(categorizeDomain("yelp.com", NONE, NONE)).toBe("listings");
		expect(categorizeDomain("m.yelp.com", NONE, NONE)).toBe("listings");
		expect(categorizeDomain("facebook.com", NONE, NONE)).toBe("social");
	});

	it("never takes a brand's own domain", () => {
		expect(category("https://bbb.org/about", new Set(["bbb.org"]))).toBe("brand");
	});
});
