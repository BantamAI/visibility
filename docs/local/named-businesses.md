# Named businesses

The mention judge only answers for businesses we already track, so an answer's other businesses are invisible to it. Every located answer's text is read by an LLM that lists each business it names, and each name is looked up on Google, so that untracked competitors are captured (for competitor discovery, E53-S6) and tracked ones can be tied to a listing (`docs/local/local-mentions.md`).

## Listing

The `resolve-named-businesses` job runs every 5 minutes. For each subject it reads up to 40 located answers not yet listed, newest first, and asks the onboarding LLM (`ONBOARDING_LLM_TARGET`, or the first configured direct provider, with web search off) for every business the answer names, in order. Directories, review sites, product brands and generic descriptions are left out. For each business the model gives:

- the name, as written
- the phone, if the answer gives one (stored in E.164)
- where the answer places it: a street address, or else the city the answer puts it in, including a city that heads its list ("plumbers in Naperville")
- a link, if it gives one

The rows go in `answer_named_businesses`. A name given twice is kept once, unless the answer tells two locations apart by phone or address. `run_locations.named_businesses_version` records the extraction a run was listed with; bumping `NAMED_BUSINESSES_VERSION` lists every answer again.

An answer with no text is listed with none. An answer the model returns something unreadable for is also listed with none, and isn't retried until the next version. Any other failure, such as the provider being down, stops that subject's listing until the next tick. With the stub LLM nothing is listed, so answers wait for a real one.

## Resolving

Each distinct name, phone and address a subject's answers give is looked up once, with Places Text Search (`docs/local/place-ids.md`). The query is the name, followed by the address when the answer gives one, so that a namesake the answer places in another city is found there. The search leans toward the subject's primary area. Among the candidates whose name is the given name, or the given name with more after it (a listing's longer name), and whose phone matches when the answer gives one:

| Resolution | Meaning |
|---|---|
| `matched` | One is in or near one of the subject's areas, within 1.5 times its radius. The exact name is chosen before a longer one, then the first in Google's order. Its Place ID and CID are stored. |
| `elsewhere` | Listings of that name exist, but only outside the areas. |
| `none` | No listing of that name, or none Google could place. |

Results go in `place_resolutions`, keyed by subject, normalized name, phone and address, and are shared by every run that gives the same name. Following Google's policy, only the Place ID and CID are kept from the response. A `matched` name is looked up again after 12 months and any other after 30 days, since a new business can get a listing. When a name's resolution changes, the runs that give it are matched again.

Names are normalized by lower-casing them, reading "&" as "and", dropping punctuation and ignoring a trailing legal suffix ("LLC", "Inc."), so "Michael & Son, Inc." and "Michael and Son" are the same name.

## Cost

Each listing is one LLM call, recorded as a `usage_events` row with `event_type` `named_businesses_extraction` and the model version. Its cost is left empty, since the structured-output path doesn't report tokens. Each lookup is a Text Search Enterprise call ($0.035), recorded as a `places_call` like every other Places call.

Per subject per day, at most `EXTRACTIONS_PER_DAY` (1,000) answers are listed and `PLACES_CALLS_PER_DAY` (200) Places calls are made, counting staff's own searches on the Place IDs page. That's about $7 a day of Places spend at most. Each name is looked up only once, so after a subject's first scans most days need only a few lookups.
