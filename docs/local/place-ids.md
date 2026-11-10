# Place IDs

A Google Place ID is the one identifier that tells two same-named plumbers apart. Each subject and each tracked competitor is anchored on one, so business cards (`docs/local/answer-businesses.md`) can be matched by ID instead of by name (E53-S5).

Lookups go through Places API (New) and the Geocoding API, behind the `PlacesProvider` interface in `packages/service/src/providers/places/`. There's no Business Profile API and no owner OAuth: matching only needs the public Place ID. Set `GOOGLE_PLACES_API_KEY` to a Google Maps Platform key with both APIs enabled; without it the anchors already confirmed still apply, but nothing new can be looked up.

## Anchoring a business

On the brand's **Place IDs** settings page, Find searches Google for the business's name, leaning toward the subject's primary service area (or another one you pick). Each candidate shows its address, phone, distance from the area's center, and whether it's outside the area. Picking one stores its Place ID and Maps CID in `place_anchors`, with the search that found it and who confirmed it. Change replaces an anchor; Remove deletes it.

The same page takes each business's phone and address (Edit Contact), which matching also uses; see `docs/local/local-mentions.md`.

Elmo replaces a brand's competitor rows every time competitors are saved, so a competitor's anchor is tied to its name, case-insensitively, not its row. Renaming a competitor leaves its anchor behind, and it needs finding again.

## What's stored, and for how long

Google's [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies) let Place IDs be stored indefinitely, and coordinates for at most 30 days. Nothing else from a Places response may be cached, so `place_anchors` holds only the Place ID and the CID. On this page, names, addresses and phones are shown from a live search and never saved. The subject's own name, phone, address and service area come from the facts API (linked clients) or manual entry (prospects).

The CID is read from the place's `googleMapsUri` (`https://maps.google.com/?cid=…&g_mp=…`), since some answer cards link by CID instead of Place ID. Google's policy names only the Place ID as exempt, so the CID is treated as the Place ID's companion: it's replaced whenever the Place ID is.

`geocodeAddress()` returns Google's coordinates for an address (for location canaries, E53-S27). Whoever stores them must drop or refresh them within 30 days.

## Refreshing

Google recommends refreshing Place IDs older than 12 months. The `refresh-place-ids` job runs daily and checks each anchor not checked in that time with a Place Details call that asks only for `id`, which is free.

- A current ID gets a new `checked_at`.
- An ID Google has replaced is stored, with its new CID (one paid Place Details Pro call).
- An ID Google no longer knows (`NOT_FOUND`: the business closed or moved) marks the anchor `obsolete_at`. The page shows it as Retired by Google until someone finds the business again. Staff re-run the stored search, as Google advises, rather than the job, since the right listing needs a person to confirm it.

## Cost

Every call records a `usage_events` row (`provider` `google-places`, `event_type` `places_call`, the SKU as `model`) at list price for the first volume tier, ignoring Google's monthly free calls:

| Call | SKU | Per call |
|---|---|---|
| Text Search (with phone numbers and websites) | Text Search Enterprise | $0.035 |
| Place ID refresh | Place Details Essentials (IDs Only) | $0 |
| CID for a replaced ID | Place Details Pro | $0.017 |
| Geocode | Geocoding | $0.005 |

Every request names its fields in a field mask, since Google bills a call at the tier of the costliest field asked for. Phone numbers lift Text Search to Enterprise; they're worth it, because a phone is the surest way to tell two same-named businesses apart. Websites are an Enterprise field too, so asking for them costs nothing more.

Places calls are made by staff, by the daily refresh, by the job that looks up the businesses answers name (`docs/local/named-businesses.md`), and by competitor seeding (`docs/local/competitor-discovery.md`). The last two stop for the day once a subject has made 200 calls. None of these are runs, so they're outside the vendor spend stops (`docs/local/vendor-spend.md`). To cap all Places spend, set a per-day request quota on the key in Google Cloud.
