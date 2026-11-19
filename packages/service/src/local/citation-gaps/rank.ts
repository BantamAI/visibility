import type { CitationCategory } from "@workspace/lib/citations/domain-categories";

/** A located run in the area, with the businesses that count as mentioned in it. */
export interface GapRun {
	runId: string;
	model: string;
	subjectCounted: boolean;
	/** Tracked competitors that count in the run. */
	competitors: readonly string[];
}

export interface GapCitation {
	runId: string;
	domain: string;
	url: string;
	title: string | null;
	category: CitationCategory;
}

export interface GapPage {
	url: string;
	title: string | null;
	runs: number;
}

export interface CitationGap {
	domain: string;
	category: CitationCategory;
	/** Answers naming a tracked competitor that cite it. */
	runs: number;
	engines: string[];
	/** Each competitor named in answers that cite it, with how many. */
	competitors: { name: string; runs: number }[];
	/** Its pages those answers cite, most cited first. */
	pages: GapPage[];
	score: number;
}

const OWNED: ReadonlySet<CitationCategory> = new Set(["brand", "competitor"]);
const PAGES_SHOWN = 3;

interface Tally {
	subjectCited: boolean;
	runs: Set<string>;
	engines: Set<string>;
	competitors: Map<string, Set<string>>;
	pages: Map<string, { title: string | null; runs: Set<string> }>;
	categories: Map<CitationCategory, number>;
}

const byCount = <T>(entries: Iterable<[T, number]>) =>
	[...entries].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));

/**
 * The sources cited in answers that name a tracked competitor but never in one that names the
 * subject, ranked by answers × engines × competitors. The subject's and competitors' own sites aren't
 * sources to win, so they're left out.
 */
export function rankCitationGaps(runs: readonly GapRun[], citations: readonly GapCitation[]): CitationGap[] {
	const runById = new Map(runs.map((run) => [run.runId, run]));
	const tallies = new Map<string, Tally>();
	for (const citation of citations) {
		const run = runById.get(citation.runId);
		if (!run || OWNED.has(citation.category)) continue;
		const tally: Tally = tallies.get(citation.domain) ?? {
			subjectCited: false,
			runs: new Set(),
			engines: new Set(),
			competitors: new Map(),
			pages: new Map(),
			categories: new Map(),
		};
		tallies.set(citation.domain, tally);
		if (run.subjectCounted) tally.subjectCited = true;
		if (run.competitors.length === 0) continue;
		tally.runs.add(run.runId);
		tally.engines.add(run.model);
		for (const name of run.competitors) {
			const named = tally.competitors.get(name) ?? new Set<string>();
			named.add(run.runId);
			tally.competitors.set(name, named);
		}
		const page = tally.pages.get(citation.url) ?? { title: null, runs: new Set<string>() };
		page.title ??= citation.title;
		page.runs.add(run.runId);
		tally.pages.set(citation.url, page);
		tally.categories.set(citation.category, (tally.categories.get(citation.category) ?? 0) + 1);
	}

	const gaps: CitationGap[] = [];
	for (const [domain, tally] of tallies) {
		if (tally.subjectCited || tally.runs.size === 0) continue;
		const competitors = byCount([...tally.competitors].map(([name, named]) => [name, named.size] as [string, number]));
		gaps.push({
			domain,
			category: byCount(tally.categories)[0][0],
			runs: tally.runs.size,
			engines: [...tally.engines].sort(),
			competitors: competitors.map(([name, count]) => ({ name, runs: count })),
			pages: byCount([...tally.pages].map(([url, page]) => [url, page.runs.size] as [string, number]))
				.slice(0, PAGES_SHOWN)
				.map(([url, count]) => ({ url, title: tally.pages.get(url)?.title ?? null, runs: count })),
			score: tally.runs.size * tally.engines.size * competitors.length,
		});
	}
	return gaps.sort((a, b) => b.score - a.score || b.runs - a.runs || a.domain.localeCompare(b.domain));
}
