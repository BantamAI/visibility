import type { RunLocation } from "../../src/providers/types";

export type SubjectId = "raleigh" | "denver" | "naperville";

export interface Point {
	id: string;
	subject: SubjectId;
	latitude: number;
	longitude: number;
	/** Row and column on the 5×5 grid; only Raleigh's points have them. */
	cell?: { row: number; col: number };
}

export interface Subject {
	id: SubjectId;
	kind: "metro" | "suburb";
	city: string;
	region: string;
	regionName: string;
	googleCanonicalName: string;
	timezone: string;
	/** Businesses within this distance of the point asked from count as local. */
	radiusMiles: number;
	center: { latitude: number; longitude: number };
	/** Center plus one point this far north, east, south and west. */
	spokeMiles: number;
}

export const SUBJECTS: readonly Subject[] = [
	{
		id: "raleigh",
		kind: "metro",
		city: "Raleigh",
		region: "NC",
		regionName: "North Carolina",
		googleCanonicalName: "Raleigh,North Carolina,United States",
		timezone: "America/New_York",
		radiusMiles: 10,
		center: { latitude: 35.7796, longitude: -78.6382 },
		spokeMiles: 6,
	},
	{
		id: "denver",
		kind: "metro",
		city: "Denver",
		region: "CO",
		regionName: "Colorado",
		googleCanonicalName: "Denver,Colorado,United States",
		timezone: "America/Denver",
		radiusMiles: 10,
		center: { latitude: 39.7392, longitude: -104.9903 },
		spokeMiles: 6,
	},
	{
		id: "naperville",
		kind: "suburb",
		city: "Naperville",
		region: "IL",
		regionName: "Illinois",
		googleCanonicalName: "Naperville,Illinois,United States",
		timezone: "America/Chicago",
		radiusMiles: 6,
		center: { latitude: 41.7508, longitude: -88.1535 },
		spokeMiles: 4,
	},
];

const MILES_PER_DEGREE_LAT = 69;

function offset(from: { latitude: number; longitude: number }, northMiles: number, eastMiles: number) {
	const milesPerDegreeLng = MILES_PER_DEGREE_LAT * Math.cos((from.latitude * Math.PI) / 180);
	return {
		latitude: round(from.latitude + northMiles / MILES_PER_DEGREE_LAT),
		longitude: round(from.longitude + eastMiles / milesPerDegreeLng),
	};
}

const round = (value: number) => Math.round(value * 1e5) / 1e5;

const SPOKES = [
	["c", 0, 0],
	["n", 1, 0],
	["e", 0, 1],
	["s", -1, 0],
	["w", 0, -1],
] as const;

export function spokePoints(subject: Subject): Point[] {
	return SPOKES.map(([id, north, east]) => ({
		id: `${subject.id}-${id}`,
		subject: subject.id,
		...offset(subject.center, north * subject.spokeMiles, east * subject.spokeMiles),
	}));
}

/** 3 miles apart, so the grid's middle row and column land on Raleigh's spoke points. */
export const GRID_SPACING_MILES = 3;
const GRID_SIZE = 5;

export function gridPoints(subject: Subject): Point[] {
	const half = (GRID_SIZE - 1) / 2;
	return Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, i) => {
		const row = Math.floor(i / GRID_SIZE);
		const col = i % GRID_SIZE;
		return {
			id: `${subject.id}-g${row}${col}`,
			subject: subject.id,
			cell: { row, col },
			...offset(subject.center, (half - row) * GRID_SPACING_MILES, (col - half) * GRID_SPACING_MILES),
		};
	});
}

export const GRID_SUBJECT: SubjectId = "raleigh";

export function getSubject(id: string): Subject {
	const subject = SUBJECTS.find((candidate) => candidate.id === id);
	if (!subject) throw new Error(`Unknown subject "${id}". Known: ${SUBJECTS.map((s) => s.id).join(", ")}`);
	return subject;
}

export function isCenter(point: Point): boolean {
	return point.id.endsWith("-c");
}

/** Centroid routes only take a city, so every point of a subject sends its city's fields. */
export function runLocation(point: Point): RunLocation {
	const subject = getSubject(point.subject);
	return {
		pointId: point.id,
		latitude: point.latitude,
		longitude: point.longitude,
		city: subject.city,
		region: subject.region,
		country: "US",
		timezone: subject.timezone,
		googleCanonicalName: subject.googleCanonicalName,
	};
}
