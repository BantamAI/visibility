import { describe, expect, it } from "vitest";
import {
	type DigestIndex,
	groundReport,
	type LocalSource,
	playbookPrompt,
	type RawLocalReport,
	type SubjectFacts,
} from "./playbook";

const yelp: LocalSource = {
	domain: "yelp.com",
	category: "listings",
	pages: [{ title: "Best plumbers in Raleigh", domain: "yelp.com", url: "https://www.yelp.com/search?raleigh" }],
};
const wral: LocalSource = { domain: "wral.com", category: "local-news", pages: [] };

const index: DigestIndex = {
	promptIdByText: new Map([
		["who is the best plumber near me?", "p-best"],
		["how much does a plumber in raleigh, nc charge?", "p-cost"],
	]),
	sources: new Map([
		["yelp.com", yelp],
		["wral.com", wral],
	]),
	citationsByPrompt: new Map([
		[
			"p-best",
			[
				{ title: "Acme", domain: "acmeplumbing.com", url: "https://acmeplumbing.com/", owner: "competitor", count: 3 },
				{ title: "Us", domain: "ourplumbing.com", url: "https://ourplumbing.com/raleigh", owner: "brand", count: 1 },
			],
		],
	]),
};

const FACTS: SubjectFacts = { source: "facts-api", facts: [{ label: "Phone", value: "+19195550100" }] };

const item = (overrides: Partial<RawLocalReport["opportunities"][number]> = {}) => ({
	category: "listings" as const,
	title: "Claim the Yelp profile",
	why: "Yelp is cited when Acme is named.",
	onPage: false,
	sources: ["yelp.com"],
	relatedPrompts: ["Who is the best plumber near me?"],
	...overrides,
});

const raw = (opportunities: RawLocalReport["opportunities"]): RawLocalReport => ({
	summary: ["Acme leads in Raleigh."],
	opportunities,
	risks: ["Few answers in Cary."],
});

describe("groundReport", () => {
	it("cites the sources and tracked prompts each opportunity is based on", () => {
		const report = groundReport(raw([item()]), index, null);

		expect(report.variant).toBe("local");
		expect(report.opportunities).toEqual([
			expect.objectContaining({
				title: "Claim the Yelp profile",
				sources: [yelp],
				relatedPrompts: [{ text: "Who is the best plumber near me?", promptId: "p-best" }],
				yourCitations: [{ title: "Us", domain: "ourplumbing.com", url: "https://ourplumbing.com/raleigh" }],
				competitorCitations: [{ title: "Acme", domain: "acmeplumbing.com", url: "https://acmeplumbing.com/" }],
			}),
		]);
	});

	it("matches sources written as URLs or with www, and prompts in any case", () => {
		const [opportunity] = groundReport(
			raw([item({ sources: ["https://www.Yelp.com/biz/acme"], relatedPrompts: ["WHO IS THE BEST PLUMBER NEAR ME?"] })]),
			index,
			null,
		).opportunities;

		expect(opportunity?.sources).toEqual([yelp]);
		expect(opportunity?.relatedPrompts.map(({ promptId }) => promptId)).toEqual(["p-best"]);
	});

	it("drops what the data didn't show, and an opportunity left with no source or no prompt", () => {
		const report = groundReport(
			raw([
				item({
					title: "Grounded",
					sources: ["yelp.com", "made-up.com"],
					relatedPrompts: ["Who is the best plumber near me?", "Not tracked"],
				}),
				item({ title: "No known source", sources: ["made-up.com"] }),
				item({ title: "No known prompt", relatedPrompts: ["Not tracked"] }),
				item({ title: "Nothing cited", sources: [], relatedPrompts: [] }),
			]),
			index,
			null,
		);

		expect(report.opportunities.map(({ title }) => title)).toEqual(["Grounded"]);
		expect(report.opportunities[0]?.sources.map(({ domain }) => domain)).toEqual(["yelp.com"]);
		expect(report.opportunities[0]?.relatedPrompts.map(({ promptId }) => promptId)).toEqual(["p-best"]);
	});

	it("allows on-page advice only when the facts come from the facts API", () => {
		const opportunities = [
			item({ category: "service-pages", title: "Add LocalBusiness schema with your phone", onPage: true }),
			item({ category: "service-pages", title: "Publish a Cary drain cleaning page", onPage: false }),
		];

		expect(groundReport(raw(opportunities), index, null).opportunities.map(({ title }) => title)).toEqual([
			"Publish a Cary drain cleaning page",
		]);
		expect(groundReport(raw(opportunities), index, { source: "facts-api", facts: [] }).opportunities).toHaveLength(1);
		expect(groundReport(raw(opportunities), index, FACTS).opportunities).toHaveLength(2);
	});

	it("keeps one of each repeated opportunity, summary bullet and risk", () => {
		const report = groundReport(
			{
				summary: ["Acme leads.", " acme leads. "],
				opportunities: [item(), item({ title: "claim the yelp profile " })],
				risks: ["Thin data.", "Thin data."],
			},
			index,
			null,
		);

		expect(report.summary).toEqual(["Acme leads."]);
		expect(report.opportunities).toHaveLength(1);
		expect(report.risks).toEqual(["Thin data."]);
	});
});

describe("playbookPrompt", () => {
	it("keeps Elmo's ethical rules and forbids review gating, fake or AI-written reviews and rating incentives", () => {
		const prompt = playbookPrompt("BUSINESS: Our Plumbing", null);

		expect(prompt).toContain("Wikipedia");
		expect(prompt).toContain("sock puppets");
		expect(prompt).toContain("no review gating");
		expect(prompt).toContain("no reviews written by AI");
		expect(prompt).toContain("No incentive tied to a rating");
	});

	it("forbids on-page advice and shows no facts unless they come from the facts API", () => {
		const without = playbookPrompt("BUSINESS: Our Plumbing", null);
		expect(without).toContain("Set onPage to false for every opportunity");
		expect(without).not.toContain("=== FACTS");

		const withFacts = playbookPrompt("BUSINESS: Our Plumbing", FACTS);
		expect(withFacts).not.toContain("Set onPage to false for every opportunity");
		expect(withFacts).toContain("=== FACTS (from the business's own record) ===\n- Phone: +19195550100");
	});
});
