import { cidInUrl, e164, textOrNull } from "../../local/answer-businesses/card";
import type {
	GeocodedAddress,
	PlaceCandidate,
	PlaceIdCheck,
	PlacesProvider,
	PlacesResponse,
	PlacesSku,
	SearchArea,
} from "./types";

const PLACES_URL = "https://places.googleapis.com/v1";
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

/** List price per call at the first volume tier, ignoring the monthly free calls. */
export const PLACES_SKU_COST_USD: Record<PlacesSku, number> = {
	text_search_enterprise: 0.035,
	place_details_ids_only: 0,
	place_details_pro: 0.017,
	geocoding: 0.005,
};

/** Text Search caps a bias circle's radius. */
const MAX_BIAS_RADIUS_M = 50_000;

// Phone numbers and websites lift the call to the Enterprise SKU; phones are what tell two same-named businesses apart.
const CANDIDATE_FIELDS = [
	"places.id",
	"places.displayName",
	"places.formattedAddress",
	"places.location",
	"places.types",
	"places.primaryType",
	"places.googleMapsUri",
	"places.nationalPhoneNumber",
	"places.internationalPhoneNumber",
	"places.websiteUri",
].join(",");

export class PlacesApiError extends Error {
	override name = "PlacesApiError";
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

interface ApiPlace {
	id?: string;
	displayName?: { text?: string };
	formattedAddress?: string;
	location?: { latitude?: number; longitude?: number };
	types?: string[];
	primaryType?: string;
	googleMapsUri?: string;
	nationalPhoneNumber?: string;
	internationalPhoneNumber?: string;
	websiteUri?: string;
}

export function candidateFrom(place: ApiPlace): PlaceCandidate | null {
	const name = textOrNull(place.displayName?.text);
	if (!place.id || !name) return null;
	const lat = place.location?.latitude;
	const lng = place.location?.longitude;
	const hasLocation = typeof lat === "number" && typeof lng === "number";
	return {
		placeId: place.id,
		cid: cidInUrl(place.googleMapsUri),
		name,
		phone: e164(place.internationalPhoneNumber) ?? e164(place.nationalPhoneNumber),
		address: textOrNull(place.formattedAddress),
		lat: hasLocation ? lat : null,
		lng: hasLocation ? lng : null,
		primaryType: textOrNull(place.primaryType),
		types: place.types ?? [],
		mapsUrl: textOrNull(place.googleMapsUri),
		website: textOrNull(place.websiteUri),
	};
}

type Fetch = typeof fetch;

export function googlePlacesProvider(apiKey: string, fetchImpl: Fetch = fetch): PlacesProvider {
	async function call(url: string, init: RequestInit & { fieldMask?: string }): Promise<Response> {
		const headers = new Headers(init.headers);
		headers.set("X-Goog-Api-Key", apiKey);
		if (init.fieldMask) headers.set("X-Goog-FieldMask", init.fieldMask);
		if (init.body) headers.set("Content-Type", "application/json");
		return fetchImpl(url, { ...init, headers, signal: AbortSignal.timeout(15_000) });
	}

	async function failure(response: Response): Promise<PlacesApiError> {
		const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
		return new PlacesApiError(
			response.status,
			`Google Places returned ${response.status}: ${body?.error?.message ?? response.statusText}`,
		);
	}

	return {
		async searchText(query, area): Promise<PlacesResponse<PlaceCandidate[]>> {
			const response = await call(`${PLACES_URL}/places:searchText`, {
				method: "POST",
				fieldMask: CANDIDATE_FIELDS,
				body: JSON.stringify({
					textQuery: query,
					regionCode: "US",
					pageSize: 10,
					...(area && { locationBias: { circle: biasCircle(area) } }),
				}),
			});
			if (!response.ok) throw await failure(response);
			const body = (await response.json()) as { places?: ApiPlace[] };
			const candidates = (body.places ?? []).flatMap((place) => candidateFrom(place) ?? []);
			return { data: candidates, sku: "text_search_enterprise" };
		},

		async checkPlaceId(placeId): Promise<PlacesResponse<PlaceIdCheck>> {
			const response = await call(`${PLACES_URL}/places/${encodeURIComponent(placeId)}`, {
				method: "GET",
				fieldMask: "id",
			});
			const sku = "place_details_ids_only";
			if (response.status === 404) return { data: { status: "not_found" }, sku };
			if (!response.ok) throw await failure(response);
			const body = (await response.json()) as ApiPlace;
			if (!body.id) throw new PlacesApiError(response.status, "Google Places returned a place with no id");
			return { data: { status: "current", placeId: body.id }, sku };
		},

		async mapsCid(placeId): Promise<PlacesResponse<string | null>> {
			const response = await call(`${PLACES_URL}/places/${encodeURIComponent(placeId)}`, {
				method: "GET",
				fieldMask: "id,googleMapsUri",
			});
			if (!response.ok) throw await failure(response);
			const body = (await response.json()) as ApiPlace;
			return { data: cidInUrl(body.googleMapsUri), sku: "place_details_pro" };
		},

		async geocode(address): Promise<PlacesResponse<GeocodedAddress | null>> {
			const url = new URL(GEOCODE_URL);
			url.searchParams.set("address", address);
			url.searchParams.set("region", "us");
			url.searchParams.set("key", apiKey);
			const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
			if (!response.ok) throw await failure(response);
			const body = (await response.json()) as GeocodeBody;
			const sku = "geocoding";
			if (body.status === "ZERO_RESULTS") return { data: null, sku };
			if (body.status !== "OK") {
				throw new PlacesApiError(response.status, `Geocoding returned ${body.status}: ${body.error_message ?? ""}`);
			}
			const [first] = body.results ?? [];
			const location = first?.geometry?.location;
			if (!first || !location) return { data: null, sku };
			return {
				data: {
					lat: location.lat,
					lng: location.lng,
					formattedAddress: first.formatted_address ?? address,
					placeId: first.place_id ?? null,
				},
				sku,
			};
		},
	};
}

interface GeocodeBody {
	status: string;
	error_message?: string;
	results?: {
		formatted_address?: string;
		place_id?: string;
		geometry?: { location?: { lat: number; lng: number } };
	}[];
}

function biasCircle(area: SearchArea) {
	return {
		center: { latitude: area.lat, longitude: area.lng },
		radius: Math.min(area.radiusMeters, MAX_BIAS_RADIUS_M),
	};
}
