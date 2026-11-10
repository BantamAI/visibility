import { cityTag } from "../run-planner/constants";
import { distanceMeters } from "../service-areas/geo";
import type { TemplateCity } from "./templates";

export interface AreaCity extends TemplateCity {
	tag: string;
	/** The city whose centroid is nearest the area's center. */
	main: boolean;
}

export interface AreaCities {
	area: { id: string; name: string; isPrimary: boolean };
	cities: AreaCity[];
}

interface Area {
	id: string;
	name: string;
	isPrimary: boolean;
	centerLat: number;
	centerLng: number;
}

interface Centroid {
	areaId: string;
	city: string | null;
	region: string | null;
	lat: number;
	lng: number;
}

/** Each area's centroid cities, nearest the center first, so the first is the main one. */
export function citiesByArea(areas: readonly Area[], centroids: readonly Centroid[]): AreaCities[] {
	return areas.map((area) => {
		const center = { lat: area.centerLat, lng: area.centerLng };
		const byTag = new Map<string, { city: TemplateCity; meters: number }>();
		for (const point of centroids) {
			if (point.areaId !== area.id || !point.city) continue;
			const tag = cityTag(point.city, point.region);
			const meters = distanceMeters(center, point);
			const known = byTag.get(tag);
			if (!known || meters < known.meters) byTag.set(tag, { city: { city: point.city, region: point.region }, meters });
		}
		const cities = [...byTag.entries()]
			.sort(([, a], [, b]) => a.meters - b.meters)
			.map(([tag, { city }], index) => ({ ...city, tag, main: index === 0 }));
		return { area: { id: area.id, name: area.name, isPrimary: area.isPrimary }, cities };
	});
}

/** Where the branded fact prompts place the business: the primary area's main city, else the first area's. */
export function factCityOf(areas: readonly AreaCities[]): AreaCity | null {
	const area = areas.find((a) => a.area.isPrimary && a.cities.length > 0) ?? areas.find((a) => a.cities.length > 0);
	return area?.cities[0] ?? null;
}
