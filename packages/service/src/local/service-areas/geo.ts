import type { AreaPolygon, Position } from "../schema";

export type LatLng = { lat: number; lng: number };

export type AreaShape = {
	centerLat: number;
	centerLng: number;
	radiusMeters: number;
	polygon?: AreaPolygon | null;
};

const EARTH_RADIUS_M = 6_371_008.8;
const METERS_PER_DEGREE_LAT = 111_320;

export const MIN_GRID_SIZE = 3;
export const MAX_GRID_SIZE = 7;
export const DEFAULT_ZIP_POINTS = 12;
export const MAX_ZIP_POINTS = 50;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Six decimals is about 0.1 m, so stored points compare equal across runs. */
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

export function distanceMeters(a: LatLng, b: LatLng): number {
	const dLat = toRadians(b.lat - a.lat);
	const dLng = toRadians(b.lng - a.lng);
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function insideRing(point: LatLng, ring: Position[]): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > point.lat !== yj > point.lat && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

function insidePolygonRings(point: LatLng, rings: Position[][]): boolean {
	const [outer, ...holes] = rings;
	if (!outer || !insideRing(point, outer)) return false;
	return !holes.some((hole) => insideRing(point, hole));
}

export function insidePolygon(point: LatLng, polygon: AreaPolygon): boolean {
	if (polygon.type === "Polygon") return insidePolygonRings(point, polygon.coordinates);
	return polygon.coordinates.some((rings) => insidePolygonRings(point, rings));
}

export function insideArea(point: LatLng, area: AreaShape): boolean {
	const center = { lat: area.centerLat, lng: area.centerLng };
	if (distanceMeters(center, point) > area.radiusMeters) return false;
	return !area.polygon || insidePolygon(point, area.polygon);
}

/** The lat/lng box that holds the area's circle, widened by `marginMeters`. */
export function boundingBox(area: AreaShape, marginMeters = 0) {
	const reach = area.radiusMeters + marginMeters;
	const dLat = reach / METERS_PER_DEGREE_LAT;
	const dLng = reach / (METERS_PER_DEGREE_LAT * Math.cos(toRadians(area.centerLat)));
	return {
		minLat: area.centerLat - dLat,
		maxLat: area.centerLat + dLat,
		minLng: area.centerLng - dLng,
		maxLng: area.centerLng + dLng,
	};
}

export type GridCell = LatLng & { row: number; col: number };

/**
 * The centres of an N×N lattice of equal cells over the area's bounding square,
 * north-west first, keeping those inside the radius and polygon. Cell centres rather
 * than edges keep a 3×3 grid whole inside the circle; larger grids lose their corners.
 */
export function coordinateGrid(area: AreaShape, size: number): GridCell[] {
	if (!Number.isInteger(size) || size < MIN_GRID_SIZE || size > MAX_GRID_SIZE) {
		throw new RangeError(`Grid size must be a whole number from ${MIN_GRID_SIZE} to ${MAX_GRID_SIZE}`);
	}
	const step = (2 * area.radiusMeters) / size;
	const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.cos(toRadians(area.centerLat));
	const middle = (size - 1) / 2;
	const cells: GridCell[] = [];
	for (let row = 0; row < size; row++) {
		for (let col = 0; col < size; col++) {
			const lat = round6(area.centerLat + ((middle - row) * step) / METERS_PER_DEGREE_LAT);
			const lng = round6(area.centerLng + ((col - middle) * step) / metersPerDegreeLng);
			if (insideArea({ lat, lng }, area)) cells.push({ row, col, lat, lng });
		}
	}
	return cells;
}

export function nearest<T extends LatLng>(point: LatLng, candidates: readonly T[]): T | undefined {
	let best: T | undefined;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const candidate of candidates) {
		const distance = distanceMeters(point, candidate);
		if (distance < bestDistance) {
			best = candidate;
			bestDistance = distance;
		}
	}
	return best;
}

function isPosition(value: unknown): value is Position {
	return (
		Array.isArray(value) &&
		value.length >= 2 &&
		typeof value[0] === "number" &&
		typeof value[1] === "number" &&
		Math.abs(value[0]) <= 180 &&
		Math.abs(value[1]) <= 90
	);
}

function isRingList(value: unknown): value is Position[][] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(isPosition))
	);
}

/** Accepts a GeoJSON Polygon or MultiPolygon, bare or wrapped in a Feature. */
export function parseAreaPolygon(input: unknown): AreaPolygon {
	const geometry =
		input && typeof input === "object" && (input as { type?: unknown }).type === "Feature"
			? (input as { geometry?: unknown }).geometry
			: input;
	if (geometry && typeof geometry === "object") {
		const { type, coordinates } = geometry as { type?: unknown; coordinates?: unknown };
		if (type === "Polygon" && isRingList(coordinates)) return { type, coordinates };
		if (
			type === "MultiPolygon" &&
			Array.isArray(coordinates) &&
			coordinates.length > 0 &&
			coordinates.every(isRingList)
		) {
			return { type, coordinates };
		}
	}
	throw new Error("The boundary must be a GeoJSON Polygon or MultiPolygon in longitude, latitude order");
}
