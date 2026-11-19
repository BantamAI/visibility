import type { CitationCategory } from "@workspace/lib/citations/domain-categories";
import type { CitationGap } from "../citation-gaps";
import { type MetricRun, mentionRates } from "../local-metrics/metrics";
import {
	type CitedPage,
	type DigestIndex,
	type LocalSource,
	normalizeDomain,
	normalizeText,
	type OwnedCitation,
} from "./playbook";

export interface DigestCitation {
	runId: string;
	promptId: string;
	domain: string;
	url: string;
	title: string | null;
	category: CitationCategory;
}

export interface DigestArea {
	name: string;
	primary: boolean;
	/** Its tracked competitors. */
	competitors: readonly string[];
	/** Its matched located runs in the window. */
	runs: readonly MetricRun[];
	/** What those runs cite. */
	citations: readonly DigestCitation[];
	gaps: readonly CitationGap[];
}

export interface DigestInput {
	subject: { name: string; website: string | null };
	services: readonly { name: string; jobs: readonly string[] }[];
	prompts: readonly { id: string; value: string; tags: readonly string[]; branded: boolean }[];
	areas: readonly DigestArea[];
	windowDays: number;
}

export interface LocalDigest {
	text: string;
	index: DigestIndex;
}

const PROMPTS_PER_AREA = 15;
const CITED_VIA_DOMAINS = 3;
const GAPS_PER_AREA = 10;
const NAMED_WITH_DOMAINS = 5;
const COMPETITOR_DOMAINS = 5;
const PAGES_PER_SOURCE = 3;

const pct = (rate: number | null) => (rate === null ? "n/a" : `${Math.round(rate * 100)}%`);

function countBy<T>(items: Iterable<T>, key: (item: T) => string): [string, number][] {
	const counts = new Map<string, number>();
	for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
	return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function engineLine(runs: readonly MetricRun[]): string {
	return mentionRates(runs, (run) => run.model)
		.map((row) => `${row.key} ${pct(row.rate)} of ${row.trials} (95% CI ${pct(row.low)}-${pct(row.high)})`)
		.join(" · ");
}

function sourceMixLine(citations: readonly DigestCitation[]): string {
	if (citations.length === 0) return "no citations yet";
	return countBy(citations, (citation) => citation.category)
		.map(([category, count]) => `${category} ${pct(count / citations.length)}`)
		.join(", ");
}

interface PromptStanding {
	promptId: string;
	runs: number;
	subjectRate: number;
	leader: { name: string; rate: number } | null;
}

function promptStandings(runs: readonly MetricRun[]): PromptStanding[] {
	const byPrompt = new Map<string, MetricRun[]>();
	for (const run of runs) byPrompt.set(run.promptId, [...(byPrompt.get(run.promptId) ?? []), run]);
	return [...byPrompt]
		.map(([promptId, promptRuns]) => {
			const [top] = countBy(
				promptRuns.flatMap((run) => [...new Set(run.competitors)]),
				(name) => name,
			);
			return {
				promptId,
				runs: promptRuns.length,
				subjectRate: promptRuns.filter((run) => run.subject).length / promptRuns.length,
				leader: top ? { name: top[0], rate: top[1] / promptRuns.length } : null,
			};
		})
		.sort(
			(a, b) =>
				(b.leader?.rate ?? 0) - b.subjectRate - ((a.leader?.rate ?? 0) - a.subjectRate) ||
				b.runs - a.runs ||
				a.promptId.localeCompare(b.promptId),
		);
}

/** The subject's located answer data as text the playbook prompt reads, with what each opportunity may cite. */
export function buildLocalDigest(input: DigestInput): LocalDigest | null {
	const areas = input.areas.filter((area) => area.runs.length > 0);
	if (areas.length === 0) return null;

	const promptById = new Map(input.prompts.map((prompt) => [prompt.id, prompt]));
	const allCitations = input.areas.flatMap((area) => area.citations);
	const listedPrompts = new Map<string, string>();
	const listedDomains = new Map<string, CitationCategory>();
	const listDomain = (domain: string, category: CitationCategory) => {
		const key = normalizeDomain(domain);
		if (!listedDomains.has(key)) listedDomains.set(key, category);
		return `${key} [${category}]`;
	};

	const domainCategory = (citations: readonly DigestCitation[], domain: string) =>
		countBy(
			citations.filter((citation) => citation.domain === domain),
			(citation) => citation.category,
		)[0]?.[0] as CitationCategory;

	const topDomains = (citations: readonly DigestCitation[], limit: number) =>
		countBy(citations, (citation) => citation.domain)
			.slice(0, limit)
			.map(([domain, count]) => ({ domain, count, category: domainCategory(citations, domain) }));

	const areaSection = (area: DigestArea) => {
		const subjectRuns = new Set(area.runs.filter((run) => run.subject).map((run) => run.runId));
		const standings = promptStandings(area.runs).slice(0, PROMPTS_PER_AREA);
		const promptLines = standings.flatMap((standing, i) => {
			const prompt = promptById.get(standing.promptId);
			if (!prompt) return [];
			listedPrompts.set(normalizeText(prompt.value), prompt.id);
			const tags = prompt.tags.length > 0 ? ` [${prompt.tags.join(", ")}]` : "";
			const leader = standing.leader
				? `top rival ${standing.leader.name} ${pct(standing.leader.rate)}`
				: "no tracked competitor named";
			const citedVia = topDomains(
				area.citations.filter((citation) => citation.promptId === prompt.id && citation.category !== "brand"),
				CITED_VIA_DOMAINS,
			).map(({ domain, category }) => listDomain(domain, category));
			return [
				`  ${i + 1}. ${prompt.branded ? "*" : ""}"${prompt.value}"${tags} — you ${pct(standing.subjectRate)} of ${standing.runs} answers, ${leader}; cited via: ${citedVia.join(", ") || "no citations"}`,
			];
		});
		const gapLines = area.gaps.slice(0, GAPS_PER_AREA).map((gap, i) => {
			const competitors = gap.competitors.map(({ name, runs }) => `${name} (${runs})`).join(", ");
			return `  ${i + 1}. ${listDomain(gap.domain, gap.category)} — ${gap.runs} answers naming a competitor; engines ${gap.engines.join(", ")}; competitors ${competitors}`;
		});
		const namedWith = topDomains(
			area.citations.filter((citation) => subjectRuns.has(citation.runId)),
			NAMED_WITH_DOMAINS,
		).map(({ domain, category, count }) => `${listDomain(domain, category)} (${count})`);
		const competitorOwned = topDomains(
			area.citations.filter((citation) => citation.category === "competitor"),
			COMPETITOR_DOMAINS,
		).map(({ domain, category, count }) => `${listDomain(domain, category)} (${count})`);

		return [
			`AREA: ${area.name}${area.primary ? " (primary)" : ""} — ${area.runs.length} answers; tracked competitors: ${area.competitors.join(", ") || "none"}`,
			`- Named in, by engine: ${engineLine(area.runs)}`,
			`- Source mix: ${sourceMixLine(area.citations)}`,
			`- PROMPTS (top ${promptLines.length} by gap to the leading competitor; "*" = branded):`,
			...promptLines,
			`- CITATION GAPS (cited when a competitor is named, never when you are):`,
			...(gapLines.length > 0 ? gapLines : ["  none"]),
			`- Cited in answers that name you: ${namedWith.join(", ") || "none"}`,
			`- Competitors' own sites cited (context only; you can't be listed there): ${competitorOwned.join(", ") || "none"}`,
		].join("\n");
	};

	const sections = areas.map(areaSection);
	const services = input.services.map(({ name, jobs }) => (jobs.length > 0 ? `${name} (${jobs.join(", ")})` : name));
	const text = [
		`BUSINESS: ${input.subject.name}${input.subject.website ? ` (${input.subject.website})` : ""}`,
		`SERVICES: ${services.join("; ") || "not listed"}`,
		`WINDOW: the last ${input.windowDays} days.`,
		"",
		sections.join("\n\n"),
	].join("\n");

	return { text, index: digestIndex(listedPrompts, listedDomains, allCitations) };
}

function pagesByDomain(citations: readonly DigestCitation[]) {
	const pages = new Map<string, Map<string, { page: CitedPage; count: number }>>();
	for (const { domain, url, title } of citations) {
		const key = normalizeDomain(domain);
		const byUrl = pages.get(key) ?? new Map<string, { page: CitedPage; count: number }>();
		const seen = byUrl.get(url);
		byUrl.set(url, { page: { title: seen?.page.title ?? title, domain: key, url }, count: (seen?.count ?? 0) + 1 });
		pages.set(key, byUrl);
	}
	return pages;
}

function digestIndex(
	promptIdByText: Map<string, string>,
	listedDomains: Map<string, CitationCategory>,
	citations: readonly DigestCitation[],
): DigestIndex {
	const pages = pagesByDomain(citations);
	const sources = new Map<string, LocalSource>();
	for (const [domain, category] of listedDomains)
		sources.set(domain, {
			domain,
			category,
			pages: [...(pages.get(domain)?.values() ?? [])]
				.sort((a, b) => b.count - a.count || a.page.url.localeCompare(b.page.url))
				.slice(0, PAGES_PER_SOURCE)
				.map(({ page }) => page),
		});

	const owned = new Map<string, Map<string, OwnedCitation>>();
	for (const citation of citations) {
		if (citation.category !== "brand" && citation.category !== "competitor") continue;
		const byUrl = owned.get(citation.promptId) ?? new Map<string, OwnedCitation>();
		const seen = byUrl.get(citation.url);
		byUrl.set(citation.url, {
			title: seen?.title ?? citation.title,
			domain: normalizeDomain(citation.domain),
			url: citation.url,
			owner: citation.category,
			count: (seen?.count ?? 0) + 1,
		});
		owned.set(citation.promptId, byUrl);
	}
	return {
		promptIdByText,
		sources,
		citationsByPrompt: new Map([...owned].map(([promptId, byUrl]) => [promptId, [...byUrl.values()]])),
	};
}
