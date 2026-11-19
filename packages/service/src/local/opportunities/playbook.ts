import type { CitationCategory } from "@workspace/lib/citations/domain-categories";
import { z } from "zod";

export const LOCAL_OPPORTUNITY_CATEGORIES = [
	"listings",
	"reviews",
	"gbp",
	"local-press-community",
	"service-pages",
] as const;
export type LocalOpportunityCategory = (typeof LOCAL_OPPORTUNITY_CATEGORIES)[number];

/** The subject's facts as the platform's facts API serves them: the only facts on-page advice may rest on. */
export interface SubjectFacts {
	source: "facts-api";
	facts: { label: string; value: string }[];
}

const LocalOpportunitySchema = z.object({
	category: z
		.enum(LOCAL_OPPORTUNITY_CATEGORIES)
		.describe(
			"listings (claim, complete or correct the business's profile on a directory answers cite), reviews (earn more genuine reviews on a platform answers cite), gbp (the Google Business Profile itself), local-press-community (local news, community sites, local associations and events), service-pages (the business's own pages for a service or city).",
		),
	title: z
		.string()
		.describe(
			'Short, specific, action-oriented; name the concrete site or page. e.g. "Claim and complete the Angi profile" or "Publish a water heater replacement page for Cary".',
		),
	why: z
		.string()
		.describe(
			"One or two plain sentences an owner who has never used this tool understands: why it's worth doing and the payoff. You may include one concrete figure from the data, saying what it measures and in which area.",
		),
	onPage: z
		.boolean()
		.describe(
			"True only when the action changes what's on the business's own existing website pages (adding facts, schema, FAQs, headings). False for everything else, including publishing a new page.",
		),
	sources: z
		.array(z.string())
		.describe("The domains from the data (verbatim, e.g. yelp.com) this opportunity is based on. At least one."),
	relatedPrompts: z
		.array(z.string())
		.describe(
			"The tracked prompts from the data (verbatim, exactly as written) this opportunity is based on. At least one.",
		),
});

export const localOpportunitiesSchema = z.object({
	summary: z
		.array(z.string())
		.describe(
			"3-5 bullets, one short sentence each (about 20 words): where competitors out-appear the business and in which areas, which sources answers lean on, and the through-line of the plan. Don't restate mention rates or define metrics.",
		),
	opportunities: z
		.array(LocalOpportunitySchema)
		.describe("8-12 prioritized opportunities spread across the categories the data supports, highest impact first."),
	risks: z.array(z.string()).describe("2-4 very short caveats: hard-to-win areas, thin data, or tactics to avoid."),
});

export type RawLocalReport = z.infer<typeof localOpportunitiesSchema>;

export interface CitedPage {
	title: string | null;
	domain: string;
	url: string;
}

export interface LocalSource {
	domain: string;
	category: CitationCategory;
	/** Its pages the subject's located answers cite most. */
	pages: CitedPage[];
}

export interface LocalOpportunity {
	category: LocalOpportunityCategory;
	title: string;
	why: string;
	onPage: boolean;
	relatedPrompts: { text: string; promptId: string }[];
	sources: LocalSource[];
	/** Pages on the subject's own sites cited for those prompts. */
	yourCitations: CitedPage[];
	/** Pages on competitors' own sites cited for those prompts. */
	competitorCitations: CitedPage[];
}

export interface LocalOpportunitiesReport {
	variant: "local";
	summary: string[];
	opportunities: LocalOpportunity[];
	risks: string[];
}

/** What grounding checks an opportunity's citations against: only what the digest showed the model. */
export interface DigestIndex {
	promptIdByText: ReadonlyMap<string, string>;
	sources: ReadonlyMap<string, LocalSource>;
	citationsByPrompt: ReadonlyMap<string, readonly OwnedCitation[]>;
}

export interface OwnedCitation extends CitedPage {
	owner: "brand" | "competitor";
	count: number;
}

const GUIDANCE = `You are a local-search strategist advising an agency that markets a home-services business (plumbing, HVAC, electrical, cleaning, roofing and similar). From the business's tracked AI answer data, produce a prioritized, practical set of opportunities to get the business named and cited more often when people near it ask AI assistants (Google AI Mode, Google AI Overviews, ChatGPT, Gemini, Perplexity, Claude) for a local service.

HOW TO READ THE DATA BELOW (say what a figure measures whenever you use one):
- Each service area is reported on its own. Answers were asked from sample points inside that area.
- "named in X% of N answers (95% CI a-b%)": the share of the area's answers that name the business, with its confidence interval. Few answers means a wide interval; don't overstate small samples.
- Per prompt, "you X% · top rival NAME Y%": the share of that prompt's answers in the area naming the business vs the competitor named most.
- "[category]" after a domain: what kind of source it is. listings = business directories and map listings (Google Business Profile and Maps, Yelp, Angi, BBB, Nextdoor, HomeAdvisor, Thumbtack, Apple Maps, Bing Places, Facebook pages); local-news = news sites for the metro; brand = the business's own site; competitor = a competitor's own site.
- CITATION GAPS: sources the area's answers cite when they name a competitor and never when they name the business, ranked by answers x engines x competitors. These are the strongest leads.
- "[tags]" after a prompt: service:<service>, intent:<intent>, near-me or city-named, city:<city>.
- Prompts marked "*" are branded (they name the business). Unbranded prompts are where new customers are won, so weight them higher.

Sort every opportunity into one of five categories:
- listings: claim, complete or correct the business's profile on a directory or listing site answers cite, with the same name, phone and address everywhere.
- reviews: earn more genuine reviews, from real customers, on the review platforms answers cite.
- gbp: the Google Business Profile itself (primary and secondary categories, services, service area, hours, photos, posts, Q&A), which the Google surfaces lean on.
- local-press-community: local news coverage, community and neighborhood sites, local associations, chambers of commerce, sponsoring or showing up at local events.
- service-pages: the business's own pages for each service and city it serves.

Assistants answer local questions from listings, reviews and local sources far more than from a business's own site, so most opportunities should earn that third-party presence. A service or city page is worth it when answers for that service or city cite competitors' pages and none of the business's.

Hard rules:
- ETHICAL: never suggest creating or editing the business's own Wikipedia or encyclopedia entry (a conflict of interest, against policy), and never suggest fake, incentivized or undisclosed reviews, astroturfing, sock puppets or any coordinated inauthentic activity. Assistants and platforms increasingly detect and penalize these.
- REVIEWS: no review gating: ask every customer the same way, never only the happy ones, and never screen who gets asked by how they're likely to rate. No fake reviews and no reviews written by AI, by staff, or for customers. No incentive tied to a rating or to a review being positive.
- AFFORDABLE: prefer low-cost actions a small business or its agency can run: claiming and completing profiles, asking customers for reviews, pitching a local reporter, joining a local association, publishing a page. Don't make the main action expensive (paid ads, large sponsorships, PR retainers).
- GROUNDED: tie every opportunity to the data. Put the domains it rests on in sources and the tracked prompts it helps in relatedPrompts, both copied verbatim from the data; an opportunity missing either is discarded. Name the concrete site, never a vague "local presence". Prefer sources where competitors are cited and the business isn't. Never recommend getting listed on a competitor's own site.`;

const VERIFIABLE_WITHOUT_FACTS = `- VERIFIABLE: you can't see the contents of any page and have no verified facts about the business, so never recommend on-page specifics for its site (adding an FAQ, schema, headings, hours, prices). A service-pages opportunity may only propose publishing a page for a service or city where competitors' pages are cited and the business's aren't. Set onPage to false for every opportunity.`;

const VERIFIABLE_WITH_FACTS = `- VERIFIABLE: the FACTS section is the business's own verified record. For the business's own site only, you may recommend on-page changes that publish those facts (for example LocalBusiness schema with its phone and address, the services it lists, its hours, the cities it serves, its licensing) and set onPage to true for them. Use only the facts given: never invent hours, prices, licenses or service areas. Never recommend on-page specifics for any other site.`;

const TASK = `Using ONLY the data above, return the structured output:
- summary: 3-5 bullets, one short sentence each.
- opportunities: 8-12 prioritized opportunities (highest impact first), each with a category, a plain-language why, the domains it rests on (sources) and the tracked prompts it helps (relatedPrompts), both verbatim from the data. Spread them across the categories the data supports; don't force all five.
- risks: 2-4 short caveats.`;

function factsSection(facts: SubjectFacts | null): string {
	if (!facts || facts.facts.length === 0) return "";
	return `\n\n=== FACTS (from the business's own record) ===\n${facts.facts.map(({ label, value }) => `- ${label}: ${value}`).join("\n")}`;
}

/** On-page advice needs facts from the facts API; anything else keeps Elmo's rule against it. */
export const onPageAllowed = (facts: SubjectFacts | null) => facts?.source === "facts-api" && facts.facts.length > 0;

export function playbookPrompt(digestText: string, facts: SubjectFacts | null): string {
	const verifiable = onPageAllowed(facts) ? VERIFIABLE_WITH_FACTS : VERIFIABLE_WITHOUT_FACTS;
	return `${GUIDANCE}\n${verifiable}\n\n=== BUSINESS DATA ===\n${digestText}${factsSection(onPageAllowed(facts) ? facts : null)}\n\n=== TASK ===\n${TASK}`;
}

export const normalizeText = (text: string) => text.trim().toLowerCase();

export const normalizeDomain = (domain: string) =>
	domain
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, "")
		.replace(/^www\./, "")
		.replace(/\/.*$/, "");

function distinctBy<T>(items: readonly T[], key: (item: T) => string): T[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		const id = key(item);
		if (seen.has(id)) return false;
		seen.add(id);
		return true;
	});
}

const CITATIONS_SHOWN = 8;

function citationsFor(promptIds: readonly string[], index: DigestIndex) {
	const byUrl = new Map<string, OwnedCitation>();
	for (const id of promptIds)
		for (const citation of index.citationsByPrompt.get(id) ?? []) {
			const seen = byUrl.get(citation.url);
			byUrl.set(citation.url, seen ? { ...seen, count: seen.count + citation.count } : citation);
		}
	const owned = (owner: OwnedCitation["owner"]) =>
		[...byUrl.values()]
			.filter((citation) => citation.owner === owner)
			.sort((a, b) => b.count - a.count || a.url.localeCompare(b.url))
			.slice(0, CITATIONS_SHOWN)
			.map(({ title, domain, url }) => ({ title, domain, url }));
	return { yourCitations: owned("brand"), competitorCitations: owned("competitor") };
}

/**
 * Keeps the opportunities the data backs: each cites at least one source and one prompt the digest
 * showed, and on-page advice only stands when the facts came from the facts API. Anything the model
 * cited that the digest didn't show is dropped.
 */
export function groundReport(
	raw: RawLocalReport,
	index: DigestIndex,
	facts: SubjectFacts | null,
): LocalOpportunitiesReport {
	const allowOnPage = onPageAllowed(facts);
	const opportunities = raw.opportunities.flatMap((item): LocalOpportunity[] => {
		if (item.onPage && !allowOnPage) return [];
		const relatedPrompts = distinctBy(
			item.relatedPrompts.flatMap((text) => {
				const promptId = index.promptIdByText.get(normalizeText(text));
				return promptId ? [{ text: text.trim(), promptId }] : [];
			}),
			({ promptId }) => promptId,
		);
		const sources = distinctBy(
			item.sources.flatMap((domain) => {
				const source = index.sources.get(normalizeDomain(domain));
				return source ? [source] : [];
			}),
			({ domain }) => domain,
		);
		if (relatedPrompts.length === 0 || sources.length === 0) return [];
		return [
			{
				category: item.category,
				title: item.title.trim(),
				why: item.why.trim(),
				onPage: item.onPage,
				relatedPrompts,
				sources,
				...citationsFor(
					relatedPrompts.map(({ promptId }) => promptId),
					index,
				),
			},
		];
	});
	return {
		variant: "local",
		summary: distinctBy(raw.summary, normalizeText),
		opportunities: distinctBy(opportunities, ({ title }) => normalizeText(title)),
		risks: distinctBy(raw.risks, normalizeText),
	};
}
