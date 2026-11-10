import { distanceMeters } from "../service-areas/geo";
import type { MatchableCard, NearArea } from "./match";

export interface AreaCircle {
	lat: number;
	lng: number;
	radiusMeters: number;
}

/** Businesses just outside an area still serve it, and show up for points inside it. */
export const NEAR_AREA_FACTOR = 1.5;

/** The ZIP after the state in a US address: "8820 Midway West Rd, Raleigh, NC 27617". */
export function zipOf(address: string | null): string | null {
	const match = address && /,\s*[A-Z]{2}\s+(\d{5})(?:-\d{4})?\b/.exec(address);
	return match ? match[1] : null;
}

/** Places a card by its ZIP's Census point; a card with no ZIP, or one not in the table, can't be placed. */
export function nearAreaByZip(areas: AreaCircle[], zips: Map<string, { lat: number; lng: number }>): NearArea {
	return (card: MatchableCard) => {
		const zip = zipOf(card.address);
		const point = zip ? zips.get(zip) : undefined;
		if (!point || areas.length === 0) return null;
		return areas.some(
			(area) => distanceMeters({ lat: area.lat, lng: area.lng }, point) <= area.radiusMeters * NEAR_AREA_FACTOR,
		);
	};
}
