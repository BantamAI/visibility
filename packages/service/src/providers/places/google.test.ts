import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { googlePlacesProvider, PlacesApiError } from "./google";

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

type Sent = { url: string; init: RequestInit };

function fakeFetch(status: number, body: string) {
	const sent: Sent[] = [];
	const impl = (async (url: string | URL, init?: RequestInit) => {
		sent.push({ url: String(url), init: init ?? {} });
		return new Response(body, { status, headers: { "Content-Type": "application/json" } });
	}) as typeof fetch;
	return { impl, sent };
}

const header = (sent: Sent, name: string) => new Headers(sent.init.headers).get(name);

describe("searchText", () => {
	it("returns candidates with Place ID, CID, E.164 phone, address, coordinates and categories", async () => {
		const { impl } = fakeFetch(200, fixture("text-search.json"));
		const { data, sku } = await googlePlacesProvider("key", impl).searchText("Acme Plumbing", null);

		expect(sku).toBe("text_search_enterprise");
		expect(data).toEqual([
			{
				placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
				cid: "10281119596374313554",
				name: "Acme Plumbing",
				phone: "+16145550142",
				address: "123 Example St, Columbus, OH 43215, USA",
				lat: 39.9612,
				lng: -82.9988,
				primaryType: "plumber",
				types: ["plumber", "point_of_interest", "establishment"],
				mapsUrl: "https://maps.google.com/?cid=10281119596374313554",
			},
			expect.objectContaining({ placeId: "ChIJrTLr-GyuEmsRBfy61i59si0", name: "Acme Plumbing & Drain", phone: null }),
		]);
	});

	it("asks only for the fields it reads, and leans toward the area without passing Google's radius cap", async () => {
		const { impl, sent } = fakeFetch(200, fixture("text-search.json"));
		await googlePlacesProvider("key", impl).searchText("Acme Plumbing", { lat: 39.96, lng: -83, radiusMeters: 80_000 });

		const [request] = sent;
		expect(request.url).toBe("https://places.googleapis.com/v1/places:searchText");
		expect(header(request, "X-Goog-Api-Key")).toBe("key");
		expect(header(request, "X-Goog-FieldMask")?.split(",")).toEqual(
			expect.arrayContaining(["places.id", "places.displayName", "places.googleMapsUri", "places.nationalPhoneNumber"]),
		);
		expect(header(request, "X-Goog-FieldMask")).not.toContain("*");
		expect(JSON.parse(String(request.init.body))).toMatchObject({
			textQuery: "Acme Plumbing",
			locationBias: { circle: { center: { latitude: 39.96, longitude: -83 }, radius: 50_000 } },
		});
	});

	it("searches without a bias when there's no area", async () => {
		const { impl, sent } = fakeFetch(200, "{}");
		const { data } = await googlePlacesProvider("key", impl).searchText("Acme Plumbing", null);
		expect(data).toEqual([]);
		expect(JSON.parse(String(sent[0].init.body))).not.toHaveProperty("locationBias");
	});

	it("throws Google's message when the call fails", async () => {
		const { impl } = fakeFetch(403, JSON.stringify({ error: { message: "API key not valid" } }));
		await expect(googlePlacesProvider("key", impl).searchText("x", null)).rejects.toThrow(
			new PlacesApiError(403, "Google Places returned 403: API key not valid"),
		);
	});
});

describe("checkPlaceId", () => {
	it("refreshes with the free IDs-only field mask", async () => {
		const { impl, sent } = fakeFetch(200, fixture("place-details-ids-only.json"));
		const result = await googlePlacesProvider("key", impl).checkPlaceId("ChIJN1t_tDeuEmsRUsoyG83frY4");

		expect(result).toEqual({
			data: { status: "current", placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4" },
			sku: "place_details_ids_only",
		});
		expect(sent[0].url).toBe("https://places.googleapis.com/v1/places/ChIJN1t_tDeuEmsRUsoyG83frY4");
		expect(header(sent[0], "X-Goog-FieldMask")).toBe("id");
	});

	it("reports an obsolete Place ID as not found rather than failing", async () => {
		const { impl } = fakeFetch(404, fixture("place-details-not-found.json"));
		const { data } = await googlePlacesProvider("key", impl).checkPlaceId("ChIJgone");
		expect(data).toEqual({ status: "not_found" });
	});
});

describe("mapsCid", () => {
	it("reads the CID from the place's Maps link", async () => {
		const { impl, sent } = fakeFetch(200, fixture("place-details-maps-uri.json"));
		const result = await googlePlacesProvider("key", impl).mapsCid("ChIJN1t_tDeuEmsRUsoyG83frY4");
		expect(result).toEqual({ data: "10281119596374313554", sku: "place_details_pro" });
		expect(header(sent[0], "X-Goog-FieldMask")).toBe("id,googleMapsUri");
	});
});

describe("geocode", () => {
	it("returns the first result's coordinates", async () => {
		const { impl } = fakeFetch(200, fixture("geocode.json"));
		const result = await googlePlacesProvider("key", impl).geocode("123 Example St, Columbus, OH");
		expect(result).toEqual({
			data: {
				lat: 39.9612,
				lng: -82.9988,
				formattedAddress: "123 Example St, Columbus, OH 43215, USA",
				placeId: "ChIJd8BlQ2BZwokRAFUEcm_qrcA",
			},
			sku: "geocoding",
		});
	});

	it("returns nothing for an address Google can't place", async () => {
		const { impl } = fakeFetch(200, JSON.stringify({ results: [], status: "ZERO_RESULTS" }));
		expect((await googlePlacesProvider("key", impl).geocode("nowhere")).data).toBeNull();
	});

	it("throws when Google refuses the request", async () => {
		const { impl } = fakeFetch(200, JSON.stringify({ status: "REQUEST_DENIED", error_message: "bad key" }));
		await expect(googlePlacesProvider("key", impl).geocode("x")).rejects.toThrow("REQUEST_DENIED");
	});
});
