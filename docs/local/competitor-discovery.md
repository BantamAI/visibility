# Competitor discovery

A plumber's competitors in Raleigh aren't its competitors in Denver, and nobody should have to type them in. Each service area keeps its own list of competitors in `area_competitors`, one row per Google listing (Place ID). The list is filled two ways: from Google before the first scan, and then from the businesses the area's answers keep naming.

## Services

A subject's services (`subject_services`) are what it sells, written as people search for it: "plumber", "water heater repair". Add them on the brand's **Local Competitors** settings page.

A prompt counts toward a service when it carries the tag `service:<service>` (case doesn't matter), such as `service:plumber`. Prompts tagged with no service count toward the area as a whole. Prompts from the Local Prompts page carry these tags (`docs/local/prompt-templates.md`).

## Seeding from Google

Each service is searched on Google once in each area (Places Text Search on the service's name, leaning toward the area). The listings Google places within 1.5 times the area's radius are kept in Google's order, leaving out the subject itself (by its anchored Place ID or its name). `competitor_seed_searches` records each search so it isn't repeated. Adding a service or an area searches it on the next run, or straight away when the service is added on the page.

A seeded business is stored under the name and website Google gives, with its Place ID and CID.

## Businesses answers name

A run counts toward an area when its sample point is in that area and it ran within the last 90 days. A business counts in a run when:

- the answer names it and its name resolves to a listing near the subject's areas (`docs/local/named-businesses.md`), or
- the answer shows a card for it with a Place ID, placed near the run's area by its coordinates or its ZIP. The map pack beside an AI Overview is Google's ranking, not the AI's, so it doesn't count.

The subject itself is never counted. Each business is counted once per run, per area and per service.

## What an area tracks

An area tracks:

- every business pinned there, and
- its top automatic businesses, up to 10. A business qualifies when it was seeded, or when at least 3 runs of one service name it.

Automatic businesses are ranked by how many runs name them. On a tie, one already tracked keeps its place, so the list doesn't flip as runs come in. After that, seeded businesses keep Google's order. So seeded businesses fill the list until answers name enough others to push them out.

The three numbers (runs before tracking, competitors per area, days of runs counted) can be changed per subject on the settings page (`competitor_discovery_settings`).

Pin a business to track it in that area whatever the ranking. Ignore it to never track it there. Both are per area, and either can be undone. A business is only shown as found until it's tracked. One that stops being named and was never seeded is dropped, unless it's pinned or ignored.

## Elmo's competitors

The mention judge only looks for Elmo's `competitors`, which apply to the whole brand. Discovery keeps that table in step:

- A business tracked in any area is added under its name, with its website's domain and up to 5 other names the answers use as aliases. Its Place ID is anchored in `place_anchors`, confirmed by `competitor discovery`.
- A competitor discovery added is removed, with that anchor, once no area tracks it.
- A competitor staff added is never changed or removed, even when discovery finds a business of the same name.

A domain is kept only when it can stand for the business. Directories, review sites, social pages and Google links are dropped, since every citation of them would otherwise count as the competitor's.

Adding a competitor makes the judge check the subject's past answers for that competitor only. Per-area reports read which areas track each competitor from `area_competitors`.

Elmo's Competitors page drops any competitor without a domain when it's saved, so a discovered business with no website disappears until discovery's next run adds it back. Manage local competitors on the Local Competitors page instead.

## When it runs

The `discover-competitors` job runs every 15 minutes. For each subject with a service area, it seeds new service and area pairs (up to 20 searches per run), then ranks every area and brings Elmo's competitors in step. Without `GOOGLE_PLACES_API_KEY`, nothing is seeded, but businesses named in answers are still found. Changing a status or a setting on the page ranks the areas again straight away.

## Cost

Each seed search is a Text Search Enterprise call ($0.035), recorded as a `places_call`. Seeding shares the subject's daily allowance of 200 Places calls with name lookups and staff searches (`docs/local/place-ids.md`). A subject with three services and two areas costs about $0.21 to seed, once.
