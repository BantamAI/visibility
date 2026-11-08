# Architecture decisions

The platform's architecture doc is the source of truth for ADRs that span the platform and this service, including ADR-22, ADR-28 (the visibility service as an Elmo fork) and ADR-31 (its local layer). This file holds the decisions that only concern the visibility service. Where one of them overrides a platform ADR, it says so, and the platform doc carries a matching note.

## ADR-32: Visibility metrics

**Status:** Accepted, 2026-11-08.

**Context.** BrightLocal reports a single 0–100 score with unpublished weights. A blended score hides which engine moved and why, and with a few dozen samples per prompt a point estimate alone overstates how much we know.

**Decision.** The headline metric is mention rate per engine with a Wilson 95% confidence interval. Share of voice, average position and sentiment are reported alongside it as separate metrics. There is no blended score.

**Consequences.**
- Reports and the API show an interval next to every mention rate, so small samples read as uncertain rather than precise.
- Each metric has to explain itself; none is folded into a weighted total.
- Comparing us with a vendor's single score takes a sentence of explanation instead of a number.

**Revisit when** prospects regularly ask for one number to compare with a vendor's score.

## ADR-33: Location fidelity, routing and our own grid

**Status:** Accepted, 2026-11-08. Supersedes the Local Falcon half of ADR-28, including its rejection of building our own geo-grid sampling (the old E53-S10), which this decision reverses.

**Context.** Engines localize answers from the location they infer for a real person: IP address, device GPS or Google's location signal. Elmo sends no location below country. Local Falcon would have supplied the grid, but it ties our sampling to a third-party product we can't inspect.

**Decision.**
- Every run records the location it requested, the method used to send it, and a fidelity tier:

  | Tier | Method | Meaning |
  |---|---|---|
  | T1 | `geo_coordinate` | Vendor sets a GPS point or Google canonical location on the real consumer surface |
  | T2 | `egress_city` | Real consumer surface reached from a residential IP in the target city or ZIP |
  | T3 | `egress_region` | Real consumer surface reached from a state-level IP |
  | T4 | `api_user_location` | Model API with its own location parameter, not the consumer surface |
  | T5 | `prompt_only` | City named in the prompt; country-level egress |

- We build the geo-grid ourselves from each subject's service areas: coordinate grids for routes that take latitude and longitude, ZIP grids (from Census ZCTA data) for routes that localize by IP egress, and city centroids for the rest. There is no Local Falcon dependency anywhere: no adapter, data, seeding or comparison runs.
- Engines in scope: Google AI Mode, Google AI Overviews, ChatGPT, Gemini, Perplexity and Claude.
- Grok is dropped. It has no terms-compatible consumer route, and vendors have discontinued it. Copilot and Grok targets stay as Elmo ships them, with no local work.
- The route for each engine comes from the SP5-L location fidelity bake-off. Location canaries decide when a route is degraded.
- No scraping of logged-in consumer accounts. Any logged-out scraping we run ourselves goes through E53-S31, after legal review.

**Consequences.**
- Fidelity is visible per run and per report, so an API approximation (T4) is never presented as a consumer-surface result.
- We own grid generation and its cost; the run planner (E53-S28) has to keep grids within each subject's budget.
- Route choices are evidence-based and can change without a new ADR when canaries or the bake-off say so.

**Revisit when** a vendor loses a surface, canaries fail for two weeks, vendor cost for an engine exceeds about 3× the estimate in E53-S28, or Grok gets a vendor-supported consumer route and clients ask for it.
