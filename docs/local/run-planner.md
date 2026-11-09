# Run planner

The run planner turns a subject's prompts, picked engines, active sample points and repeats into the located runs a schedule makes, and prices them before the schedule can be enabled. It doesn't run anything; grid scans (E53-S3) run what it plans.

## Routes

Each engine has its routes listed best first in `ROUTING_TABLE`, as SP5-L chose them (`docs/local/sp5-l-results.md`):

| Engine | Routes, best first | Points |
|---|---|---|
| Google AI Mode | DataForSEO (T1), then Cloro (T1, city level) | Grid and centroids; Cloro centroids only |
| Google AI Overviews | DataForSEO (T1), then SearchApi (T1), then Cloro (T1, city level) | Grid and centroids; Cloro centroids only |
| Claude | Anthropic API (T4) | Centroids |
| Every other engine | None below T5 | Centroids |

Each engine runs on one route: the first in this order whose target is in `SCRAPE_TARGETS` and among the subject's picked LLMs. An engine with none of these routes configured runs at T5, naming the city in the prompt and sending no location, through its first configured target. The route never changes from run to run, because results from different routes measure different things and can't share a trend line. Configuring a better route later is a deliberate change that starts a new series.

One route can still mix precisions across points. DataForSEO places grid points and city centroids exactly, while Cloro places only centroids, at city level. Every run records its tier and point, so reports can tell them apart.

When the route can't place a point (a centroid with no Google canonical name, for Cloro), the point takes the results of the nearest centroid in its area that the route can place. That centroid is already in the plan, so the point adds no runs, and the Run Plan page lists it with the centroid standing in for it. A point with no such centroid is a gap. No point ever switches to another route or tier.

When the canaries mark an engine's route degraded (E53-S27), the engine pauses: it makes no located runs until the route recovers, and it doesn't switch to another route. Runs that fail are retried on the same route, and those that still fail are recorded as gaps (E53-S3).

## Which prompts run where

Prompts tagged `near-me` run on grid points and centroids. All other prompts are taken to name a city and run on centroids only. T5 runs only city-named prompts, because a "near me" prompt with no location measures wherever the vendor's server is. So ChatGPT, Gemini and Perplexity get no near-me runs until they have a route below T5.

## Cadence

A full scan runs every point of every engine, weekly by default. Centroids on the two cheapest T1 engines (DataForSEO's AI Mode and AI Overviews, when both are configured) also run daily. Both intervals and the number of repeats are set per subject on the Run Plan page. They apply only to located runs; brand-mode runs keep Elmo's cadence.

Grid size is set per service area. SP5-L found AI Mode answers 3 miles apart overlap nearly as much as repeats at one point, so 3×3 (points about 5–6 miles apart on a 10-mile radius) is the default. Use 5×5 only for areas wider than about 20 miles.

## Cost and budget

The monthly cost is points × prompts × repeats × runs a month for each series, priced per run. DataForSEO's Google surfaces ($0.004) and Claude through the Anthropic API ($0.04) use SP5-L's measured costs. Other routes use the per-provider estimates in `packages/lib/src/usage/cost.ts`.

A schedule can't be enabled without a monthly budget, or when the plan costs more than the budget or includes a route with no cost estimate. A disabled schedule can be saved at any cost, so the plan can be tried out before it's enabled. The budget is checked when the schedule is saved. Adding prompts or areas later can push an enabled plan over budget, so the scan job has to check it again before it spends anything (E53-S3, E53-S35).
