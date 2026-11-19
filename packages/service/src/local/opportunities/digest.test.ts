import type { CitationCategory } from "@workspace/lib/citations/domain-categories";
import { describe, expect, it } from "vitest";
import type { CitationGap } from "../citation-gaps";
import type { MetricRun } from "../local-metrics/metrics";
import { buildLocalDigest, type DigestArea, type DigestCitation, type DigestInput } from "./digest";

let id = 0;
const run = (
	promptId: string,
	opts: { subject?: boolean; competitors?: string[]; model?: string } = {},
): MetricRun => ({
	runId: `run-${++id}`,
	promptId,
	model: opts.model ?? "chatgpt",
	areaId: "raleigh",
	phrasing: "near-me",
	tier: "T4",
	createdAt: new Date("2026-11-10T12:00:00Z"),
	subject: opts.subject ? { position: 1, positionFrom: "text", sentiment: null } : null,
	competitors: opts.competitors ?? [],
});

const cite = (r: MetricRun, url: string, category: CitationCategory, title: string | null = null): DigestCitation => ({
	runId: r.runId,
	promptId: r.promptId,
	domain: new URL(url).hostname.replace(/^www\./, ""),
	url,
	title,
	category,
});

const gap = (domain: string, category: CitationCategory): CitationGap => ({
	domain,
	category,
	runs: 2,
	engines: ["chatgpt", "gemini"],
	competitors: [{ name: "Acme Plumbing", runs: 2 }],
	pages: [],
	score: 4,
});

const PROMPTS = [
	{ id: "p-best", value: "Who is the best plumber near me?", tags: ["service:plumber", "near-me"], branded: false },
	{ id: "p-hours", value: "What are the hours for Our Plumbing in Raleigh, NC?", tags: [], branded: true },
	{ id: "p-unrun", value: "Who can I hire for drain cleaning near me?", tags: [], branded: false },
];

function input(areas: DigestArea[]): DigestInput {
	return {
		subject: { name: "Our Plumbing", website: "https://ourplumbing.com" },
		services: [{ name: "plumber", jobs: ["drain cleaning"] }],
		prompts: PROMPTS,
		areas,
		windowDays: 30,
	};
}

describe("buildLocalDigest", () => {
	it("has nothing to say without a matched answer", () => {
		expect(
			buildLocalDigest(input([{ name: "Raleigh", primary: true, competitors: [], runs: [], citations: [], gaps: [] }])),
		).toBeNull();
	});

	it("lists each area's prompts by gap to the leading competitor, its gaps and what the model may cite", () => {
		const lostA = run("p-best", { competitors: ["Acme Plumbing"] });
		const lostB = run("p-best", { competitors: ["Acme Plumbing"] });
		const won = run("p-hours", { subject: true });
		const digest = buildLocalDigest(
			input([
				{
					name: "Raleigh",
					primary: true,
					competitors: ["Acme Plumbing"],
					runs: [won, lostA, lostB],
					citations: [
						cite(lostA, "https://www.yelp.com/biz/acme", "listings", "Acme on Yelp"),
						cite(lostB, "https://www.yelp.com/biz/acme", "listings", "Acme on Yelp"),
						cite(lostA, "https://acmeplumbing.com/", "competitor", "Acme"),
						cite(won, "https://ourplumbing.com/hours", "brand", "Hours"),
					],
					gaps: [gap("yelp.com", "listings")],
				},
			]),
		);
		if (!digest) throw new Error("expected a digest");

		expect(digest.text).toContain("AREA: Raleigh (primary) — 3 answers; tracked competitors: Acme Plumbing");
		expect(digest.text).toContain("SERVICES: plumber (drain cleaning)");
		const best = digest.text.indexOf('"Who is the best plumber near me?"');
		const hours = digest.text.indexOf('*"What are the hours for Our Plumbing in Raleigh, NC?"');
		expect(best).toBeGreaterThan(-1);
		expect(hours).toBeGreaterThan(best);
		expect(digest.text).toContain("you 0% of 2 answers, top rival Acme Plumbing 100%; cited via: yelp.com [listings]");
		expect(digest.text).toContain("1. yelp.com [listings] — 2 answers naming a competitor; engines chatgpt, gemini");
		expect(digest.text).not.toContain("Who can I hire for drain cleaning");

		expect([...digest.index.promptIdByText.values()].sort()).toEqual(["p-best", "p-hours"]);
		expect(digest.index.sources.get("yelp.com")).toEqual({
			domain: "yelp.com",
			category: "listings",
			pages: [{ title: "Acme on Yelp", domain: "yelp.com", url: "https://www.yelp.com/biz/acme" }],
		});
		expect(digest.index.citationsByPrompt.get("p-best")).toEqual([
			expect.objectContaining({ url: "https://acmeplumbing.com/", owner: "competitor" }),
		]);
		expect(digest.index.citationsByPrompt.get("p-hours")).toEqual([
			expect.objectContaining({ url: "https://ourplumbing.com/hours", owner: "brand" }),
		]);
	});

	it("reports each engine's mention rate with its interval", () => {
		const digest = buildLocalDigest(
			input([
				{
					name: "Raleigh",
					primary: true,
					competitors: [],
					runs: [run("p-best", { subject: true }), run("p-best", { model: "gemini" })],
					citations: [],
					gaps: [],
				},
			]),
		);

		expect(digest?.text).toMatch(/chatgpt 100% of 1 \(95% CI \d+%-100%\) · gemini 0% of 1 \(95% CI 0%-\d+%\)/);
	});
});
