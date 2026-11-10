import type { AreaCompetitorStatus } from "../schema";

export interface DiscoverySettings {
	minRuns: number;
	perArea: number;
	windowDays: number;
}

export const DEFAULT_DISCOVERY_SETTINGS: DiscoverySettings = { minRuns: 3, perArea: 10, windowDays: 90 };

export interface AreaCandidate {
	placeId: string;
	name: string;
	status: AreaCompetitorStatus;
	seedRank: number | null;
	answerRuns: number;
	/** The most runs of any one service in the area, prompts with no service counting as one. */
	serviceRuns: number;
	tracked: boolean;
}

const eligible = (candidate: AreaCandidate, minRuns: number) =>
	candidate.seedRank !== null || candidate.serviceRuns >= minRuns;

/**
 * The Place IDs one area tracks: every pinned business, and the automatic ones that were seeded or
 * recur in a service's runs, the most named first, up to the area's limit. A business already tracked
 * keeps its place on a tie, so the list doesn't flip between equals as runs come in. Then Google's
 * order for the seeded, then name.
 */
export function trackedInArea(candidates: readonly AreaCandidate[], settings: DiscoverySettings): Set<string> {
	const automatic = candidates
		.filter((candidate) => candidate.status === "auto" && eligible(candidate, settings.minRuns))
		.sort(
			(a, b) =>
				b.answerRuns - a.answerRuns ||
				Number(b.tracked) - Number(a.tracked) ||
				(a.seedRank ?? Number.POSITIVE_INFINITY) - (b.seedRank ?? Number.POSITIVE_INFINITY) ||
				a.name.localeCompare(b.name),
		)
		.slice(0, settings.perArea);
	return new Set([
		...candidates.filter((candidate) => candidate.status === "pinned").map((candidate) => candidate.placeId),
		...automatic.map((candidate) => candidate.placeId),
	]);
}
