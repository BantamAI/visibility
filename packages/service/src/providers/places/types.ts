export type PlacesSku = "text_search_enterprise" | "place_details_ids_only" | "place_details_pro" | "geocoding";

/** A circle the search leans toward without excluding what's outside it. */
export interface SearchArea {
	lat: number;
	lng: number;
	radiusMeters: number;
}

export interface PlaceCandidate {
	placeId: string;
	/** Google Maps customer id, parsed from the place's Maps link. */
	cid: string | null;
	name: string;
	/** E.164. */
	phone: string | null;
	address: string | null;
	lat: number | null;
	lng: number | null;
	primaryType: string | null;
	types: string[];
	mapsUrl: string | null;
}

export type PlaceIdCheck = { status: "current"; placeId: string } | { status: "not_found" };

export interface GeocodedAddress {
	lat: number;
	lng: number;
	formattedAddress: string;
	placeId: string | null;
}

/** What a call returned and the SKU Google bills it under, so the caller can record its cost. */
export interface PlacesResponse<T> {
	data: T;
	sku: PlacesSku;
}

/** Google Places, for resolving businesses to Place IDs. Not a scrape provider. */
export interface PlacesProvider {
	searchText(query: string, area: SearchArea | null): Promise<PlacesResponse<PlaceCandidate[]>>;
	/** Free, so stored Place IDs can be refreshed as often as Google recommends. */
	checkPlaceId(placeId: string): Promise<PlacesResponse<PlaceIdCheck>>;
	/** Only the Place ID comes with the Maps link, so this is how a CID is found for an ID. */
	mapsCid(placeId: string): Promise<PlacesResponse<string | null>>;
	geocode(address: string): Promise<PlacesResponse<GeocodedAddress | null>>;
}
