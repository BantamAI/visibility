import { db } from "@workspace/lib/db/db";
import { and, between, eq, inArray, notInArray, sql } from "drizzle-orm";
import { type RefUsPlace, refUsPlaces, type SamplePointKind, type ServiceArea, samplePoints } from "../schema";
import { boundingBox, coordinateGrid, distanceMeters, insideArea, nearest } from "./geo";

export type ReferencePlace = Pick<RefUsPlace, "geoid" | "name" | "state" | "lat" | "lng" | "googleCanonicalName">;

export type PlannedPoint = {
	kind: Extract<SamplePointKind, "grid" | "centroid">;
	label: string;
	lat: number;
	lng: number;
	city: string | null;
	region: string | null;
	country: string;
	postalCode: string | null;
	timezone: string;
	googleCanonicalName: string | null;
};

/** How far past the edge to look for the place a grid point near it belongs to. */
const NEARBY_PLACE_MARGIN_M = 15_000;

/**
 * A grid point takes the city, region and Google name of the nearest Census place,
 * a stand-in for reverse geocoding that needs no lookup at run time.
 */
export function planSamplePoints(
	area: Pick<ServiceArea, "centerLat" | "centerLng" | "radiusMeters" | "polygon" | "gridSize" | "timezone" | "country">,
	nearbyPlaces: readonly ReferencePlace[],
): PlannedPoint[] {
	const fields = (place: ReferencePlace | undefined) => ({
		city: place?.name ?? null,
		region: place?.state ?? null,
		country: area.country,
		postalCode: null,
		timezone: area.timezone,
		googleCanonicalName: place?.googleCanonicalName ?? null,
	});

	const grid = coordinateGrid(area, area.gridSize).map(
		(cell): PlannedPoint => ({
			kind: "grid",
			label: `${area.gridSize}x${area.gridSize} R${cell.row + 1}C${cell.col + 1}`,
			lat: cell.lat,
			lng: cell.lng,
			...fields(nearest(cell, nearbyPlaces)),
		}),
	);

	const center = { lat: area.centerLat, lng: area.centerLng };
	let cities = nearbyPlaces.filter((place) => insideArea(place, area));
	// A small area can fall between place centroids; it still gets the nearest one.
	if (cities.length === 0) {
		const closest = nearest(center, nearbyPlaces);
		cities = closest ? [closest] : [];
	}
	const labelCounts = new Map<string, number>();
	for (const place of cities) {
		const label = `${place.name}, ${place.state}`;
		labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
	}
	const centroids = [...cities]
		.sort((a, b) => distanceMeters(center, a) - distanceMeters(center, b) || a.geoid.localeCompare(b.geoid))
		.map((place): PlannedPoint => {
			const label = `${place.name}, ${place.state}`;
			return {
				kind: "centroid",
				label: (labelCounts.get(label) ?? 0) > 1 ? `${label} (${place.geoid})` : label,
				lat: place.lat,
				lng: place.lng,
				...fields(place),
			};
		});

	return [...grid, ...centroids];
}

const GENERATED_KINDS = ["grid", "centroid"] as const;

/**
 * Makes the area's grid and centroid points match its current shape. Points are
 * keyed by label, so an unchanged area keeps its point ids, and points that no
 * longer fit are deactivated rather than deleted. Runs in the caller's tenant scope.
 */
export async function regenerateSamplePoints(area: ServiceArea): Promise<PlannedPoint[]> {
	const box = boundingBox(area, NEARBY_PLACE_MARGIN_M);
	const nearbyPlaces =
		area.country === "US"
			? await db
					.select({
						geoid: refUsPlaces.geoid,
						name: refUsPlaces.name,
						state: refUsPlaces.state,
						lat: refUsPlaces.lat,
						lng: refUsPlaces.lng,
						googleCanonicalName: refUsPlaces.googleCanonicalName,
					})
					.from(refUsPlaces)
					.where(
						and(between(refUsPlaces.lat, box.minLat, box.maxLat), between(refUsPlaces.lng, box.minLng, box.maxLng)),
					)
			: [];
	const planned = planSamplePoints(area, nearbyPlaces);

	await db.transaction(async (tx) => {
		if (planned.length > 0) {
			await tx
				.insert(samplePoints)
				.values(planned.map((point) => ({ ...point, subjectId: area.subjectId, areaId: area.id, active: true })))
				.onConflictDoUpdate({
					target: [samplePoints.areaId, samplePoints.kind, samplePoints.label],
					set: {
						lat: sql`excluded.lat`,
						lng: sql`excluded.lng`,
						city: sql`excluded.city`,
						region: sql`excluded.region`,
						country: sql`excluded.country`,
						postalCode: sql`excluded.postal_code`,
						timezone: sql`excluded.timezone`,
						googleCanonicalName: sql`excluded.google_canonical_name`,
						active: true,
						updatedAt: new Date(),
					},
				});
		}
		for (const kind of GENERATED_KINDS) {
			const kept = planned.filter((point) => point.kind === kind).map((point) => point.label);
			await tx
				.update(samplePoints)
				.set({ active: false, updatedAt: new Date() })
				.where(
					and(
						eq(samplePoints.areaId, area.id),
						eq(samplePoints.kind, kind),
						eq(samplePoints.active, true),
						kept.length > 0 ? notInArray(samplePoints.label, kept) : undefined,
					),
				);
		}
	});
	return planned;
}

export async function listSamplePoints(areaIds: string[]) {
	if (areaIds.length === 0) return [];
	return db
		.select()
		.from(samplePoints)
		.where(inArray(samplePoints.areaId, areaIds))
		.orderBy(samplePoints.areaId, samplePoints.kind, samplePoints.label);
}
