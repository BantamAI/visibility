import { cleanAndValidateDomain } from "@workspace/lib/citations/domain-categories";
import { categorizeDomain } from "@workspace/lib/citations/domain-lists";
import { nameKey, sameBusinessName } from "../named-businesses/names";

/** A prompt tagged `service:<name>` asks about that service. */
export const SERVICE_TAG_PREFIX = "service:";

export const serviceTag = (service: string) => `${SERVICE_TAG_PREFIX}${service.trim().toLowerCase()}`;

/** A business an answer names or shows a card for, tied to a Place ID, in a run located in one of the areas. */
export interface Sighting {
	runId: string;
	areaId: string;
	tags: readonly string[];
	placeId: string;
	cid: string | null;
	name: string;
	website: string | null;
}

export interface Tally {
	placeId: string;
	cid: string | null;
	website: string | null;
	runs: Set<string>;
	/** Runs by service name; prompts with no service under "". */
	runsByService: Map<string, Set<string>>;
}

/** The services a prompt's tags name, or [""] when it names none of the subject's. */
export function servicesOf(tags: readonly string[], services: readonly string[]): string[] {
	const lower = new Set(tags.map((tag) => tag.trim().toLowerCase()));
	const named = services.filter((service) => lower.has(serviceTag(service)));
	return named.length > 0 ? named : [""];
}

/** Each area's businesses, by Place ID, with the runs that name them. */
export function tallySightings(sightings: readonly Sighting[], services: readonly string[]): Map<string, Map<string, Tally>> {
	const areas = new Map<string, Map<string, Tally>>();
	for (const sighting of sightings) {
		const area = areas.get(sighting.areaId) ?? new Map<string, Tally>();
		areas.set(sighting.areaId, area);
		const tally = area.get(sighting.placeId) ?? {
			placeId: sighting.placeId,
			cid: null,
			website: null,
			runs: new Set<string>(),
			runsByService: new Map<string, Set<string>>(),
		};
		area.set(sighting.placeId, tally);
		tally.cid ??= sighting.cid;
		tally.website ??= competitorWebsite(sighting.website);
		tally.runs.add(sighting.runId);
		for (const service of servicesOf(sighting.tags, services)) {
			const runs = tally.runsByService.get(service) ?? new Set<string>();
			runs.add(sighting.runId);
			tally.runsByService.set(service, runs);
		}
	}
	return areas;
}

/** The most runs any one service gives a business. */
export const serviceRuns = (tally: Tally) => Math.max(0, ...[...tally.runsByService.values()].map((runs) => runs.size));

/** The services a business is named in runs of, leaving out prompts with none. */
export const tallyServices = (tally: Tally) => [...tally.runsByService.keys()].filter(Boolean);

/**
 * How answers write each business's name, most runs first: the first is the name it's tracked
 * under, the rest its aliases. Names that differ only in case or punctuation count as one.
 */
export function namesByPlace(sightings: readonly Sighting[]): Map<string, string[]> {
	const counts = new Map<string, Map<string, { name: string; runs: Set<string> }>>();
	for (const { placeId, name, runId } of sightings) {
		const key = nameKey(name);
		if (!key) continue;
		const names = counts.get(placeId) ?? new Map();
		counts.set(placeId, names);
		const entry = names.get(key) ?? { name: name.trim(), runs: new Set<string>() };
		entry.runs.add(runId);
		names.set(key, entry);
	}
	return new Map(
		[...counts].map(([placeId, names]) => [
			placeId,
			[...names.values()]
				.sort((a, b) => b.runs.size - a.runs.size || a.name.length - b.name.length || a.name.localeCompare(b.name))
				.map((entry) => entry.name),
		]),
	);
}

/** The subject's own name or alias, or a longer listing of it ("Oak City Plumbing of Cary"). */
export function isSubjectName(name: string, subject: { name: string; aliases: readonly string[] }): boolean {
	return [subject.name, ...subject.aliases].some((own) => own.trim() !== "" && sameBusinessName(name, own));
}

const GOOGLE_HOST = /(^|\.)google\.[a-z.]+$|^goo\.gl$/;

/**
 * A website's domain, when it can stand for the business: not a directory, review site or social
 * page, whose every citation would otherwise count as the competitor's.
 */
export function competitorDomain(website: string | null): string | null {
	const domain = website ? cleanAndValidateDomain(website) : null;
	if (!domain || GOOGLE_HOST.test(domain)) return null;
	return categorizeDomain(domain, new Set(), new Set()) === "other" ? domain : null;
}

/** The website, kept only when its domain can stand for the business. */
export const competitorWebsite = (website: string | null) => (competitorDomain(website) ? website : null);
