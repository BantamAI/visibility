import type { CitationCategory } from "@workspace/lib/citations/domain-categories";
import { describe, expect, it } from "vitest";
import { type GapCitation, type GapRun, rankCitationGaps } from "./rank";

const run = (runId: string, model: string, competitors: string[], subjectCounted = false): GapRun => ({
	runId,
	model,
	competitors,
	subjectCounted,
});

const cite = (runId: string, url: string, category: CitationCategory = "listings", title: string | null = null) =>
	({ runId, domain: new URL(url).hostname.replace(/^www\./, ""), url, title, category }) satisfies GapCitation;

describe("rankCitationGaps", () => {
	it("lists sources cited for competitors and never for the subject", () => {
		const gaps = rankCitationGaps(
			[run("r1", "chatgpt", ["Triangle Rooter"]), run("r2", "claude", ["Capital Drains"], true)],
			[
				cite("r1", "https://www.yelp.com/search?find_desc=plumbers&find_loc=Raleigh"),
				cite("r1", "https://www.angi.com/companylist/raleigh/plumbing.htm"),
				cite("r2", "https://www.angi.com/companylist/raleigh/plumbing.htm"),
			],
		);
		expect(gaps.map((gap) => gap.domain)).toEqual(["yelp.com"]);
	});

	it("ranks by answers × engines × competitors", () => {
		const gaps = rankCitationGaps(
			[
				run("r1", "chatgpt", ["Triangle Rooter", "Capital Drains"]),
				run("r2", "claude", ["Triangle Rooter"]),
				run("r3", "chatgpt", ["Triangle Rooter"]),
				run("r4", "chatgpt", ["Triangle Rooter"]),
				run("r5", "chatgpt", ["Triangle Rooter"]),
			],
			[
				// 2 answers × 2 engines × 2 competitors = 8
				cite("r1", "https://www.bbb.org/us/nc/raleigh/category/plumber"),
				cite("r2", "https://www.bbb.org/us/nc/raleigh/category/plumber"),
				// 3 answers × 1 engine × 1 competitor = 3, though cited more often
				cite("r3", "https://www.yelp.com/biz/triangle-rooter-raleigh"),
				cite("r4", "https://www.yelp.com/biz/triangle-rooter-raleigh"),
				cite("r5", "https://www.yelp.com/biz/triangle-rooter-raleigh"),
				// 1 × 1 × 1 each, a tie broken by name
				cite("r2", "https://www.nextdoor.com/pages/triangle-rooter"),
				cite("r3", "https://www.angi.com/companylist/raleigh/plumbing.htm"),
			],
		);
		expect(gaps.map(({ domain, score }) => [domain, score])).toEqual([
			["bbb.org", 8],
			["yelp.com", 3],
			["angi.com", 1],
			["nextdoor.com", 1],
		]);
	});

	it("shows which engines cited each source and which competitors appear there", () => {
		const [gap] = rankCitationGaps(
			[run("r1", "google-ai-mode", ["Triangle Rooter"]), run("r2", "chatgpt", ["Capital Drains", "Triangle Rooter"])],
			[
				cite("r1", "https://www.wral.com/story/best-plumbers", "local-news", "Best plumbers in the Triangle"),
				cite("r2", "https://www.wral.com/story/best-plumbers", "local-news"),
				cite("r2", "https://www.wral.com/story/water-heaters", "local-news"),
			],
		);
		expect(gap).toEqual({
			domain: "wral.com",
			category: "local-news",
			runs: 2,
			engines: ["chatgpt", "google-ai-mode"],
			competitors: [
				{ name: "Triangle Rooter", runs: 2 },
				{ name: "Capital Drains", runs: 1 },
			],
			pages: [
				{ url: "https://www.wral.com/story/best-plumbers", title: "Best plumbers in the Triangle", runs: 2 },
				{ url: "https://www.wral.com/story/water-heaters", title: null, runs: 1 },
			],
			score: 8,
		});
	});

	it("leaves out the subject's and competitors' own sites", () => {
		const gaps = rankCitationGaps(
			[run("r1", "chatgpt", ["Triangle Rooter"])],
			[
				cite("r1", "https://www.triangle-rooter.example/", "competitor"),
				cite("r1", "https://oakcity.example/reviews", "brand"),
			],
		);
		expect(gaps).toEqual([]);
	});

	it("ignores answers that name no tracked competitor", () => {
		const gaps = rankCitationGaps(
			[run("r1", "chatgpt", [])],
			[cite("r1", "https://www.yelp.com/search?find_desc=plumbers"), cite("r2", "https://www.angi.com/")],
		);
		expect(gaps).toEqual([]);
	});
});
