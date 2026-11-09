import { googlePlacesProvider } from "./google";
import type { PlacesProvider } from "./types";

export { candidateFrom, googlePlacesProvider, PLACES_SKU_COST_USD, PlacesApiError } from "./google";
export type {
	GeocodedAddress,
	PlaceCandidate,
	PlaceIdCheck,
	PlacesProvider,
	PlacesResponse,
	PlacesSku,
	SearchArea,
} from "./types";

export class PlacesNotConfiguredError extends Error {
	override name = "PlacesNotConfiguredError";
	constructor() {
		super("GOOGLE_PLACES_API_KEY isn't set, so businesses can't be looked up on Google");
	}
}

export function configuredPlacesProvider(): PlacesProvider {
	const key = process.env.GOOGLE_PLACES_API_KEY;
	if (!key) throw new PlacesNotConfiguredError();
	return googlePlacesProvider(key);
}
