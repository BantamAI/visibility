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

A provider lists the tiers below T5 that each model's surface can serve in `locationSupport`, with the location fields it sends at each one. A provider that leaves it out sends nothing below country, which is every provider until its vendor story (E53-S23 to E53-S26) adds a declaration. Every surface can serve T5.

Before a run, the worker checks the request against the declaration and refuses, before anything is spent, when the tier isn't listed or the point lacks a field the tier sends (a grid point far from any town has no city or Google canonical name). It never quietly runs at a lower tier. `pickRoute` walks a list of candidate routes and takes the first one that can serve the point, recording why each earlier one couldn't. The run planner (E53-S28) uses it to fall back.

An adapter receives `location` and `locationTier` only at a tier it declared, so it can trust both fields to be there.

## What a located run records

Each located run gets one `run_locations` row beside Elmo's `prompt_runs` row, written in the same transaction: the point id and a snapshot of the location sent, the method and tier, the vendor's run id and reported location when the response includes them, and the cost. The cost is the vendor's own figure when the response gives one, otherwise the per-provider estimate from `packages/lib/src/usage/cost.ts`, and `cost_source` says which. The same figure goes to `usage_events`.

Brand-mode runs, which have no location, write no row and send providers exactly the options they always have.
