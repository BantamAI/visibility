export interface LatLng {
	latitude: number;
	longitude: number;
}

export interface Business {
	name: string;
	placeId?: string;
	latitude?: number;
	longitude?: number;
}

export interface ScoredAnswer {
	route: string;
	phase: "screen" | "main" | "grid";
	subject: string;
	point: string;
	promptId: string;
	rep: number;
	businesses: Business[];
}

const EARTH_RADIUS_MILES = 3958.8;

export function milesBetween(a: LatLng, b: LatLng): number {
	const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
	const dLat = toRadians(b.latitude - a.latitude);
	const dLng = toRadians(b.longitude - a.longitude);
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number | null {
	if (a.size === 0 && b.size === 0) return null;
	const shared = [...a].filter((key) => b.has(key)).length;
	return shared / (a.size + b.size - shared);
}

const LEGAL_SUFFIXES = new Set(["llc", "inc", "co", "corp", "corporation", "company", "ltd", "the"]);

function nameTokens(name: string): string[] {
	return name
		.toLowerCase()
		.replaceAll("&", " and ")
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((token) => token && !LEGAL_SUFFIXES.has(token));
}

/** Place id when the business was placed, so "Acme Plumbing" and "Acme Plumbing LLC" are one business. */
export function businessKey(business: Business): string {
	return business.placeId ? `place:${business.placeId}` : `name:${nameTokens(business.name).join(" ")}`;
}

export const keysOf = (businesses: readonly Business[]) => new Set(businesses.map(businessKey));

const TRADE_WORDS = new Set([
	"and",
	"of",
	"plumbing",
	"plumber",
	"plumbers",
	"heating",
	"cooling",
	"air",
	"hvac",
	"drain",
	"drains",
	"sewer",
	"service",
	"services",
	"mechanical",
	"contractor",
	"contractors",
	"repair",
	"rooter",
]);

/** A map search returns its nearest guess even for a name it doesn't know, so the guess has to share the name. */
export function nameMatchesPlace(name: string, placeTitle: string): boolean {
	const nameWords = nameTokens(name);
	const titleWords = new Set(nameTokens(placeTitle));
	const distinctive = nameWords.filter((token) => !TRADE_WORDS.has(token));
	if (distinctive.length === 0) return nameWords.join(" ") === [...titleWords].join(" ");
	const found = distinctive.filter((token) => titleWords.has(token)).length;
	return found / distinctive.length >= 0.5;
}

export function isPlaced(business: Business): business is Business & LatLng {
	return business.latitude !== undefined && business.longitude !== undefined;
}

export function median(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentile(values: readonly number[], p: number): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

export function mean(values: readonly number[]): number | null {
	return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export type CanaryResult = "pass" | "fail" | "no-businesses";

/**
 * E53-S27's distance rule: an answer passes when the median distance from the point
 * asked from to the businesses it names is within the area's radius. An answer that
 * names nothing we could place can't be judged either way.
 */
export function distanceCanary(point: LatLng, businesses: readonly Business[], radiusMiles: number): CanaryResult {
	const distances = businesses.filter(isPlaced).map((business) => milesBetween(point, business));
	const middle = median(distances);
	if (middle === null) return "no-businesses";
	return middle <= radiusMiles ? "pass" : "fail";
}

export function inAreaShare(point: LatLng, businesses: readonly Business[], radiusMiles: number): number | null {
	const placed = businesses.filter(isPlaced);
	if (placed.length === 0) return null;
	return placed.filter((business) => milesBetween(point, business) <= radiusMiles).length / placed.length;
}

const sameQuestion = (a: ScoredAnswer, b: ScoredAnswer) =>
	a.route === b.route && a.phase === b.phase && a.subject === b.subject && a.promptId === b.promptId;

/** The same question asked twice from one point: how much a route's answers vary by chance. */
export function repeatOverlap(answers: readonly ScoredAnswer[]): number | null {
	const overlaps: number[] = [];
	answers.forEach((a, i) => {
		for (const b of answers.slice(i + 1)) {
			if (!sameQuestion(a, b) || a.point !== b.point) continue;
			const overlap = jaccard(keysOf(a.businesses), keysOf(b.businesses));
			if (overlap !== null) overlaps.push(overlap);
		}
	});
	return mean(overlaps);
}

/** The same question and repeat asked from two points, grouped by how far apart the points are. */
export function pointOverlapByDistance(
	answers: readonly ScoredAnswer[],
	pointAt: (id: string) => LatLng,
	bucketMiles: (miles: number) => number,
): Map<number, number> {
	const byBucket = new Map<number, number[]>();
	answers.forEach((a, i) => {
		for (const b of answers.slice(i + 1)) {
			if (!sameQuestion(a, b) || a.point === b.point || a.rep !== b.rep) continue;
			const overlap = jaccard(keysOf(a.businesses), keysOf(b.businesses));
			if (overlap === null) continue;
			const bucket = bucketMiles(milesBetween(pointAt(a.point), pointAt(b.point)));
			byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), overlap]);
		}
	});
	return new Map([...byBucket].sort(([x], [y]) => x - y).map(([bucket, values]) => [bucket, mean(values) ?? 0]));
}

/** Shared businesses over the answer's own: how many of an answer's picks a reference list also shows. */
export function shareFoundIn(businesses: readonly Business[], reference: ReadonlySet<string>): number | null {
	const keys = keysOf(businesses);
	if (keys.size === 0) return null;
	return [...keys].filter((key) => reference.has(key)).length / keys.size;
}
