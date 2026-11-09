# Run locations

A located run asks a provider for an answer as if from one sample point, at a fidelity tier from ADR-33:

| Tier | Method | Meaning |
|---|---|---|
| T1 | `geo_coordinate` | The vendor sets a GPS point or Google canonical location on the real consumer surface |
| T2 | `egress_city` | The real consumer surface, reached from a residential IP in the point's city or ZIP |
| T3 | `egress_region` | The real consumer surface, reached from a state-level IP |
| T4 | `api_user_location` | A model API's own location parameter, not the consumer surface |
| T5 | `prompt_only` | The city is named in the prompt and no location is sent |

## Declaring what a provider can serve

A provider lists the tiers below T5 that each target can serve in `locationSupport`, with the location fields it sends at each one. A provider that leaves it out sends nothing below country. Every surface can serve T5.

DataForSEO serves T1 on its two Google surfaces, the only routes that place a run at the sample point itself (`docs/local/sp5-l-results.md`). AI Mode sends the point as `location_coordinate` with a map zoom (`lat,lng,15z`); AI Overviews send it to the organic SERP with a 200-meter radius (`lat,lng,200`), and a located overview gets five tries instead of three because Google's async overview load fails far more often on near-me searches. DataForSEO moves the point by about 70 meters before asking Google, so each run records the point Google actually got, read from the `uule` in the result's `check_url`, as the vendor-reported location. Its ChatGPT and Gemini scrapers declare nothing: they accept coordinates and ignore them.

Claude is the only engine reached through a model API (ADR-33). The Anthropic API serves T4 by giving its web search tool the point's city, region, country and timezone, and by telling Claude the city, region and country in a system prompt. The tool's location only steers search results, and without the system prompt Claude answers a "near me" prompt by saying it doesn't know where the user is, without searching. Because Claude then names the city in its own search queries, T4 behaves partly like a city-named prompt. A Claude target with web search off can't serve T4, and Claude runs on city centroids. Claude through OpenRouter declares nothing. Reports label T4 results "API approximation" so they're never read as what a person sees.

Before a run, the worker checks the request against the declaration and refuses, before anything is spent, when the tier isn't listed or the point lacks a field the tier sends (a grid point far from any town has no city or Google canonical name). It never quietly runs at a lower tier or through another route. The run planner (E53-S28) uses the same check to find points a route can't place (`docs/local/run-planner.md`).

An adapter receives `location` and `locationTier` only at a tier it declared, so it can trust both fields to be there.

## What a located run records

Each located run gets one `run_locations` row beside Elmo's `prompt_runs` row, written in the same transaction: the point id and a snapshot of the location sent, the method and tier, the vendor's run id and reported location when the response includes them, and the cost. The cost is the vendor's own figure when the response gives one, otherwise the per-provider estimate from `packages/lib/src/usage/cost.ts`, and `cost_source` says which. The same figure goes to `usage_events`.

Brand-mode runs, which have no location, write no row and send providers exactly the options they always have.
