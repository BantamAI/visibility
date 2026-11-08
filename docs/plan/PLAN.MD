# Your job

Create GitHub issues, labels and milestones in this repository for the work below. **Create issues only. Don't write or change code, and don't push.**

ChatSpy is our fork of Elmo, an AI-visibility tracker built for brands. We're turning it into a **local** AI-search tracker for home-services businesses (plumbing, HVAC, electrical, cleaning, roofing). The goal is to beat BrightLocal's Local AI Visibility tracker, not just match it. This round covers the foundation: location-aware runs on six engines (Google AI Mode, Google AI Overviews, ChatGPT, Gemini, Perplexity, Claude), local understanding of answers, and the local report. Later work gets short placeholder issues with their triggers.

**Hard constraints:** no Local Falcon, anywhere (no adapter, no data, no seeding, no comparison runs). We build the geo-grid ourselves from our own sample points. Grok and Copilot are out of scope; leave Elmo's existing targets for them untouched but don't add work for them.

### If issues from an earlier version of this brief already exist

Update their bodies and titles to match this version instead of creating duplicates. Remove every mention of Local Falcon and Grok. Don't close or delete any issue; list the ones whose scope changed in your report so I can decide.

### Before creating anything

1. Run `gh auth status` and `gh repo view --json nameWithOwner,defaultBranchRef`. Stop and report if either fails.
2. Read `CLAUDE.md`, `docs/plan/architecture.md` (ADR-22, ADR-28, ADR-31), `packages/lib/src/providers/types.ts`, `packages/lib/src/providers/registry/*.ts`, `packages/docs/content/docs/user-guide/providers.mdx` and `packages/lib/src/db/schema.ts`. Add a short **Code pointers** section to each issue with the real file paths it will touch. Where this brief and the code disagree about how the code works, trust the code and say so in the issue. Where this brief and `docs/plan/` disagree about decisions (Local Falcon, Grok, engines in scope, the grid), this brief wins: those docs predate it.
3. Check for duplicates: `gh issue list --state all --search "<ID> in:title"` for every ID below. Skip any that already exist and list them in your report.
4. **Dry run first.** Print a table of every label, milestone and issue you would create (ID, title, labels, milestone, size, dependencies). Then stop and wait for me to say "go".

### After I say "go"

1. Create any labels that are missing (`gh label create --force` is fine):
   - `epic`, `story`, `spike`, `chore`, `docs`
   - `area:providers`, `area:location`, `area:local`, `area:report`, `area:data`, `area:ops`
   - `size:S`, `size:M`, `size:L`
   - `tag:Pilot`, `tag:v1`, `tag:Later`
   - `needs-spike` (build only if the location bake-off picks this route)
   - `upstream-touch` (edits an Elmo upstream file, so `scripts/upstream-diff` must be checked)
   - `legal-review` (terms-of-service risk; needs my sign-off before work starts)
2. Create the milestones: `L1 Location-aware runs`, `L2 Local understanding`, `L3 Local report and actions`, `L4 Later`. Put "Feeds platform milestone M2 (sellable wedge)" in the descriptions of L1–L3.
3. Create one epic issue per milestone, then the child issues. Add each child to its epic as a sub-issue through the GraphQL `addSubIssue` mutation (`gh api graphql`). If that fails, fall back to a task list of child issue numbers in the epic body, and say which method you used.
4. Create issues in dependency order so "Depends on" can cite real issue numbers. Edit earlier bodies once the later numbers exist.
5. Report a table: issue number, ID, title, milestone, labels, URL. Also list skipped duplicates and anything in this brief you think is wrong.

### Rules for every issue

- **Title:** `<ID> <short imperative title>`, e.g. `E53-S22 Add a location contract to providers`.
- **Body:** use this template:

```
## Why
<1–3 sentences>

## Story
| ID | Story | Acceptance criteria | Size | Tag | Milestone |
|---|---|---|---|---|---|
| ... |

## Acceptance criteria
- [ ] ...

## Design notes
...

## Code pointers
<real paths you found>

## Depends on
#<n> ...

## Out of scope
...

## Definition of done
- [ ] Unit tests for logic; fixtures recorded from real vendor responses (secrets scrubbed)
- [ ] Every new table has `subject_id` (plus `location_id` once linked), an index on it and RLS enabled; pgTAP test proves cross-subject reads and writes fail (E53-S13)
- [ ] All DB access through `withSubject()`; no bypass role in app code
- [ ] Vendor cost recorded per run and reported as usage
- [ ] License scan passes (MIT, Apache or BSD only; nothing from `ee/` or `enterprise/`)
- [ ] If labelled `upstream-touch`: the change is additive and minimal, and `scripts/upstream-diff` output is noted in the PR
- [ ] Docs updated (providers guide or `docs/local/`)

## Sources
<links from this brief that apply>
```

- Sizes: S ≈ 0.5, M ≈ 1.5, L ≈ 4 focused days. Keep stories small enough to finish in a day or two. If one looks bigger than M, split it and say so in your report.
- Our own code goes in `src/local/` or a new `packages/local` workspace package, whichever fits the monorepo (explain the choice in the first issue that creates code). Vendor adapters go next to Elmo's in `packages/lib/src/providers/registry/` as new files. Keep edits to Elmo files additive and label them `upstream-touch`.
- Don't put secrets, emails or `@mentions` in issue bodies.
- ChatSpy never contacts consumers. It tracks **subjects**: a prospect, or a client linked to a platform location.

---

## Background the issues depend on

### What Elmo does today (commit a96f1af, Nov 7 2026)

- **Scrapers:** six vendors (Cloro, Bright Data, Oxylabs, SearchApi, Olostep, DataForSEO) reach ChatGPT, Google AI Mode, Google AI Overviews, Gemini, Perplexity and Copilot. Claude and Grok are reached only through model APIs (Anthropic API, OpenRouter).
- **No location below country.** `ProviderOptions` is `{ webSearch?, version? }`. DataForSEO hard-codes `location_code` 2840 (US), with a comment that localization is intentionally not exposed. Cloro hard-codes `country: "US"`. Nothing passes a city, coordinate, proxy region or API `user_location`.
- **Brand assumptions.** Mentions are matched on name, aliases and domains, then confirmed by a judge model. Citation categories have no listings or local-news category. The opportunities prompt is written for content marketers. Runs default to about 5 a day per target.
- **Parts we keep:** raw answers in Postgres, re-derivable metrics, sentiment with passages, position, query fan-out, reports, API and MCP.
- **Out of scope:** Copilot and Grok targets stay as Elmo ships them; no local work for either.

### What BrightLocal sells (so we know what "beat" means)

- Three engines: ChatGPT, AI Overviews, AI Mode.
- Up to 20 prompts per location.
- A 0–100 score with unpublished weights.
- Per-location anchoring with an undisclosed method.
- On-demand checks.
- Competitor auto-detection, an AI sources leaderboard, and citation gaps routed into its Citation Builder.
- Included in plans from $31/month.

### How each engine localizes for a real person, and our best route

Real users get local answers from the location the engine infers: IP address, device GPS or Google's location signal. **Fidelity** is how closely our run reproduces that. Every run records its method and tier:

| Tier | Method | Meaning |
|---|---|---|
| T1 | `geo_coordinate` | Vendor sets a GPS point or Google `uule`/canonical location on the real consumer surface |
| T2 | `egress_city` | Real consumer surface reached from a residential IP in the target city or ZIP |
| T3 | `egress_region` | Real consumer surface reached from a state-level IP |
| T4 | `api_user_location` | Model API with its own location parameter (not the consumer surface) |
| T5 | `prompt_only` | City named in the prompt; country-level egress |

Candidate routes per engine. All of these are hypotheses until the bake-off (SP5-L) confirms them:

| Engine | Primary candidate | Secondary | Grid kind | API fallback |
|---|---|---|---|---|
| Google AI Mode | DataForSEO AI Mode SERP with `location_coordinate` (T1) | Cloro AI Mode with `location` (Google canonical name) or `uule` (T1, city-level only) | Coordinate grid | — |
| Google AI Overviews | DataForSEO organic SERP, `load_async_ai_overview`, `location_coordinate` (T1) | Cloro or SearchApi, if location is supported (verify) | Coordinate grid | — |
| ChatGPT | Bright Data ChatGPT scraper `geolocation` "lat,lng" field (T1 if it localizes; verify) | Bright Data residential egress by ZIP (T2); DataForSEO LLM Scraper city `location_code` (verify tier); Cloro `state` (T3) | Coordinate grid if T1 holds, else ZIP grid | OpenAI Responses `web_search` `user_location` (T4) |
| Gemini | DataForSEO Gemini LLM Scraper `location_coordinate` (T1) | Cloro `state` (T3) | Coordinate grid | Gemini API Maps grounding `latLng` + Search grounding (T4) |
| Perplexity | Cloro `state` (T3) | Bright Data (country) or SearchApi | Centroids only (consumer); API points | Sonar `web_search_options.user_location` with lat/lng, city, region and country (T4) |
| Claude | — no terms-compatible consumer route | — | API points | Anthropic `web_search` tool `user_location` (city, region, country, timezone) (T4) |

Facts behind the table:
- ChatGPT search may use an approximate location from the user's IP address, and device location sharing is off by default. So egress city matters for ChatGPT.
- Grok is out of scope: grok.com puts a sign-up wall in front of logged-out visitors, Cloro discontinued its Grok endpoint on Oct 15, 2026, and Bright Data lists its Grok scraper as unavailable.
- Claude.ai has no consumer scraper among Elmo's vendors. Anthropic's consumer terms forbid automated access except through an API key.
- OpenAI's terms forbid programmatically extracting data or output. Vendors take on the operating burden of logged-out scraping, but they don't remove the terms risk. **We don't scrape logged-in consumer accounts.** Any scraper we run ourselves is logged-out only and gated by `legal-review`.

### Sampling design (where we beat BrightLocal)

- **Sample unit:** prompt × engine × sample point × repeat.
- **Our own grid, three kinds of sample point,** all generated from each subject's service areas (no third-party grid product):
  - *Coordinate grid:* N×N lat/lng points (3×3 to 7×7) sent to T1 routes that accept coordinates (DataForSEO AI Mode, AI Overviews and Gemini; Bright Data ChatGPT if its `geolocation` field localizes).
  - *ZIP grid:* the ZIP codes whose centroids fall inside the service area (from public-domain Census ZCTA data), sent to egress-based T2 routes as city/ZIP proxy targets. A ZIP grid is coarser than a coordinate grid but matches how IP-located engines see users.
  - *Centroids:* one point per city in the service area, for T3–T5 routes. The Perplexity and Gemini APIs also accept lat/lng, so they can take the coordinate grid; Anthropic and OpenAI take only city-level fields. Report all API routes separately as API approximations.
- **Grid scan:** one scan = one prompt × one route × every active point in an area, stored as a scan record with one run per point, so we can draw per-point maps and compare scans over time.
- **Grids only where location is implicit:** "near me" prompts run on the grid; city-named prompts already carry their location, so they run on centroids only. This keeps grid cost to the prompts where it measures something.
- **Prompt phrasing:** each local prompt runs as both "near me" (location comes from the run) and city-named ("…in Raleigh, NC"). The two measure different things and are reported separately.
- **Headline metric:** mention rate per engine with a Wilson 95% confidence interval. Also reported: share of voice, average position and sentiment. No blended score (ADR-32).
- **Cadence:** a budget per subject, not Elmo's 5 runs a day. Default is weekly full grids plus daily centroid runs on the two cheapest T1 routes. The run planner refuses to start a schedule that exceeds the subject's monthly budget.

---

## Milestone L1 — Location-aware runs

### EPIC-L1 Location-aware runs on six engines

Labels: `epic`, `area:location`. Body:
- Goal: every run carries a requested location and a recorded fidelity tier, for AI Mode, AI Overviews, ChatGPT, Gemini, Perplexity and Claude, with grid scans built on our own sample points.
- Exit criteria: for 3 pilot subjects, each engine has at least one route at the best tier the bake-off found; coordinate-grid scans work for AI Mode, AI Overviews and Gemini; canaries pass at least 80% on T1/T2 routes; cost per subject per month is known and capped.
- No Local Falcon dependency anywhere.

### SP5-L Location fidelity bake-off (extends SP5)
Labels: `spike`, `area:location`, `size:M`, `tag:Pilot`. Milestone L1. Depends on: E53-S21 and E53-S22 (stubs are enough).

Story: Run a time-boxed comparison of every candidate route in the routing table, so we only build the routes that work.

Acceptance criteria:
- [ ] 3 subjects (two metros and one suburb), 5 prompts each, in "near me" and city-named forms; 5 sample points per subject.
- [ ] Every candidate route per engine is run through a throwaway script (no product code), 3 repeats each.
- [ ] Measured per route: non-empty answer rate; canary pass rate (E53-S27 method, run by hand); local-business overlap (Jaccard) with the T1 reference where one exists; cost per run; p50/p95 latency; whether map or business cards are returned.
- [ ] Grid sensitivity: for AI Mode and one other T1 engine, a 5×5 coordinate grid over one service area; report whether answers actually change across points (if adjacent points return the same businesses, a 3×3 grid is enough and saves cost). For ChatGPT, compare the coordinate route with a ZIP-egress route over the same area.
- [ ] Bright Data's ChatGPT `geolocation` field verified: does moving the point move the businesses returned? Record the answer as T1, T2 or "doesn't localize".
- [ ] The same 20 prompts run in a BrightLocal free trial for one subject; its mention rates recorded next to ours.
- [ ] Output `docs/local/sp5-l-results.md`: the chosen route per engine, the fallback, the tier, cost per 1,000 runs, and the routes rejected with reasons.
- [ ] Each `needs-spike` issue gets a comment saying build or don't build.

Design notes:
- Time-box 2 days. Spend under about $150 in vendor credits.
- Treat the provider rankings in Elmo's providers guide as one input; every vendor link on that page is an affiliate link.

### E53-S21 Model service areas and sample points
Labels: `story`, `area:data`, `area:location`, `size:M`, `tag:Pilot`. Milestone L1. Depends on: E53-S13.

Acceptance criteria:
- [ ] Tables `subject_service_areas` (name, center lat/lng, radius, optional polygon, primary flag, timezone) and `sample_points` (area, lat/lng, kind `centroid | grid | zip`, postal code, city, region, label, active).
- [ ] Coordinate-grid generator: N×N points inside a radius, clipped to the polygon when one is set; deterministic, so re-runs make the same points.
- [ ] ZIP-grid generator: ZIP codes whose ZCTA centroid falls inside the area, from Census ZCTA gazetteer data loaded as a reference table (public domain; record the vintage year). Cap the count per area (default 12), keeping the most populous.
- [ ] City centroids: one point per city in the area, with city, region and timezone filled for API routes.
- [ ] Every point carries the fields providers need (`city`, `region`, `country`, `postalCode`, `timezone`, Google canonical name where resolvable) so adapters never geocode at run time.
- [ ] Service areas entered by hand for prospects; seeded from the platform facts API for linked clients (fields as E53-S9 defines them).
- [ ] RLS and pgTAP for both tables.

### E53-S22 Add a location contract to providers
Labels: `story`, `area:providers`, `upstream-touch`, `size:M`, `tag:Pilot`. Milestone L1. Depends on: E53-S21.

Acceptance criteria:
- [ ] Additive change to `ProviderOptions`: `location?: RunLocation`, with `{ pointId, lat, lng, city, region, country, postalCode?, timezone, googleCanonicalName?, uule? }`.
- [ ] Each provider declares `locationSupport` per surface: which tiers it can serve and which fields it reads.
- [ ] A provider that can't honour the requested tier says so before the run (no silent downgrade), and the planner picks the next route.
- [ ] Every stored run records `requested_location`, `location_method`, `fidelity_tier`, `vendor_reported_location` (if returned), `vendor_run_id` and cost.
- [ ] Existing brand-mode runs (no location) behave exactly as before; regression test proves it.

Design notes: keep the interface change small and generic. Elmo may want country localization upstream, and its contributor agreement applies only if we send changes there.

### E53-S23 DataForSEO with coordinates (AI Mode, AI Overviews, Gemini, ChatGPT)
Labels: `story`, `area:providers`, `needs-spike`, `upstream-touch`, `size:M`, `tag:Pilot`. Milestone L1. Depends on: E53-S22.

Acceptance criteria:
- [ ] AI Mode SERP and organic SERP (with `load_async_ai_overview`) send `location_coordinate` from the sample point, replacing the hard-coded 2840 when a location is given.
- [ ] Gemini LLM Scraper sends `location_coordinate`.
- [ ] ChatGPT LLM Scraper resolves the city to a `location_code` from the cached locations list (download it once a week; the lists are large) and records the tier the spike found.
- [ ] Map or local-pack items in the response are kept in `rawOutput` for E53-S29.
- [ ] Fixture tests per surface.

### E53-S24 Cloro with city and state targeting
Labels: `story`, `area:providers`, `needs-spike`, `upstream-touch`, `size:S`, `tag:Pilot`. Milestone L1. Depends on: E53-S22.

Acceptance criteria:
- [ ] AI Mode sends `location` (Google canonical "City,Region,Country") or `uule` (T1).
- [ ] ChatGPT, Gemini and Perplexity send `state` for US points (T3); the hard-coded `country: "US"` comes from the location.
- [ ] Business and location entries returned by Cloro are kept for E53-S29.

### E53-S25 Bright Data ChatGPT with geolocation
Labels: `story`, `area:providers`, `needs-spike`, `upstream-touch`, `size:M`, `tag:Pilot`. Milestone L1. Depends on: E53-S22.

Acceptance criteria:
- [ ] ChatGPT dataset requests send `geolocation` "lat,lng" from the sample point and `country`.
- [ ] If the spike shows geolocation alone doesn't localize, route through a residential zone with city/ZIP targeting, and record T2 instead of T1.
- [ ] `is_map`, `map` and `business_locations` fields kept for E53-S29.
- [ ] Perplexity and Gemini datasets pass `country` only, recorded as T3 or lower.

### E53-S3 Grid scans on our own sample points
Existing backlog story ("Location-aware runs"); its old scope used Local Falcon, which is dropped. If an issue exists, retitle it and replace its body instead of creating a duplicate. Labels: `story`, `area:location`, `size:M`, `tag:Pilot`. Milestone L1. Depends on: E53-S21 and E53-S22.

Acceptance criteria:
- [ ] A `grid_scans` record groups one prompt × one route × every active point of the right kind in an area; each point becomes one run linked to the scan.
- [ ] Fan-out through the existing queue with per-vendor concurrency limits; partial failures retried per point; a scan completes with a coverage figure (points answered ÷ points planned) instead of failing outright.
- [ ] Route picks the point kind: coordinate grid for coordinate routes, ZIP grid for egress routes, centroids otherwise.
- [ ] Per-point results (answer, ranked businesses, cited sources) queryable for heat maps (E53-S32).
- [ ] Scan cost = sum of its runs; shown before a scan is scheduled (E53-S28).
- [ ] No Local Falcon code, data or comparison anywhere.

### E53-S26 API engines with user location (Claude, Perplexity, OpenAI, Gemini)
Labels: `story`, `area:providers`, `upstream-touch`, `size:M`, `tag:Pilot`. Milestone L1. Depends on: E53-S22. Split into two issues if it's larger than M.

Acceptance criteria:
- [ ] Anthropic API: `web_search` tool with `user_location` `{type: "approximate", city, region, country, timezone}`.
- [ ] Perplexity Sonar, called directly (not through OpenRouter, which may drop the field): `web_search_options.user_location` with country, region, city, latitude and longitude.
- [ ] OpenAI Responses: `web_search` with `user_location`; set explicitly so the API doesn't default to a US location.
- [ ] Gemini API: Google Search grounding, plus Maps grounding with `toolConfig.retrievalConfig.latLng` for local-intent prompts; place IDs from grounding chunks kept for E53-S30.
- [ ] All recorded as T4 and labelled "API approximation" in reports.
- [ ] Perplexity and Gemini take lat/lng, so they accept coordinate-grid points; Anthropic and OpenAI take city-level fields only, so they use city centroids.

### E53-S27 Location canaries
Labels: `story`, `area:location`, `size:M`, `tag:Pilot`. Milestone L1. Depends on: E53-S22 and at least one route.

Acceptance criteria:
- [ ] Weekly canary per (provider, surface, area): a fixed local-intent prompt ("emergency plumber near me") plus a location probe ("what city am I in?" where the surface allows it).
- [ ] Pass if the inferred city matches, or the median distance from the sample point to returned businesses is under the area radius (businesses geocoded through E53-S30).
- [ ] Pass rate per route stored and shown on an ops page. A route under 70% for two weeks is marked degraded, and the planner stops using it for T1/T2.
- [ ] Canary cost counted inside the subject budget, with a separate agency-level ops budget.

### E53-S28 Run planner and cost guard
Labels: `story`, `area:ops`, `size:M`, `tag:Pilot`. Milestone L1. Depends on: E53-S22.

Acceptance criteria:
- [ ] For each subject, the planner expands prompts × engines × points × repeats into a schedule using the routing table (best tier first, fallback on failure or degradation).
- [ ] Shows planned runs and estimated cost per month before a schedule is enabled. Refuses schedules over the subject's budget.
- [ ] Per-subject cadence overrides Elmo's default of about 5 runs a day.
- [ ] Vendor cost per run reported to the platform as usage (ADR-29 `usage_events` via the visibility API).
- [ ] Hard stop and alert when a vendor's spend for the day exceeds 2× its plan.
- [ ] Default grid size per engine comes from the SP5-L sensitivity result (3×3 unless the spike shows answers change between adjacent points).

Design notes: rough starting estimate, to be replaced by SP5-L's measured costs. Elmo's providers guide implies roughly $0.0015–0.004 per scraped run (Bright Data at the low end, DataForSEO and SearchApi at the high end). 10 "near me" prompts × a 3×3 grid × 4 grid engines × weekly ≈ 1,440 runs a month, about $3–6 per subject; a 5×5 grid is about $8–16.

### E53-S31 Logged-out scraper harness (conditional)
Labels: `story`, `area:providers`, `needs-spike`, `legal-review`, `size:L`, `tag:Later`. Milestone L4. Depends on: SP5-L.

Trigger: the spike shows no vendor reaches T2 or better for an engine we need (most likely Perplexity or ChatGPT), **and** I sign off on the terms risk.

Acceptance criteria:
- [ ] Playwright worker (separate Fly app) behind the same provider contract.
- [ ] Logged-out sessions only.
- [ ] Residential proxy with city/ZIP egress; browser geolocation, timezone and locale set to the point.
- [ ] Per-surface parsers with fixture tests; a breakage alert when the parse rate drops.
- [ ] Rate limits well under human-like volume.
- [ ] A kill switch per surface.
- [ ] Never logs in, solves CAPTCHAs or rotates accounts.

Design notes: split into one story per surface once triggered. Expect ongoing maintenance; record the time spent in each monthly review against the vendor cost it replaces.

---

## Milestone L2 — Local understanding

### EPIC-L2 Understand local answers

Labels: `epic`, `area:local`. Exit criteria: for pilot subjects, at least 95% of business mentions resolve to a Place ID or are flagged unresolved; competitors per city are found automatically; prompts come from templates.

### E53-S4 Local prompt templates
Existing backlog story; update rather than duplicate. Labels: `story`, `area:local`, `size:M`, `tag:Pilot`. Milestone L2.

Acceptance criteria:
- [ ] Generator for service × area × intent (emergency, cost, best/top, reviews, specific job such as "water heater replacement"). Each prompt has a "near me" variant and a city-named variant.
- [ ] Branded prompts for E53-S16 ("is <business> licensed", "<business> hours").
- [ ] Prompts tagged with type, service, intent and phrasing, using Elmo's tags.
- [ ] No 20-prompt cap; the budget is the limit.

### E53-S30 Google Places connector for entity resolution
Labels: `story`, `area:providers`, `size:M`, `tag:Pilot`. Milestone L2.

Acceptance criteria:
- [ ] Places API (New) Text Search and Place Details behind a `PlacesProvider` interface. No Business Profile API and no owner OAuth: matching only needs the public Place ID.
- [ ] **Anchor every subject and tracked competitor on a Place ID.** On subject setup, Text Search on name + area returns candidates; I confirm the right one; the Place ID is stored on the subject (and on each competitor as it's resolved).
- [ ] Also store the Maps CID parsed from the place's `googleMapsUri` when present, since some answer cards link by CID rather than Place ID (verify the URL format in the spike).
- [ ] Resolves an unknown business name plus area to candidates with Place ID, name, phone, address, coordinates and categories, at match time.
- [ ] Geocodes addresses for canaries.
- [ ] Caching rule: Google exempts the Place ID from caching restrictions, so it's stored indefinitely and refreshed when older than 12 months (Place Details with the ID field only). Other Google fields follow the Places policy limits; enforce with expiry. The subject's own name, phone, address and service area come from the facts API (linked clients) or my manual entry (prospects), not from cached Google data.
- [ ] Cost per call recorded.

### E53-S5 Local business matching
Existing backlog story; update rather than duplicate. Labels: `story`, `area:local`, `upstream-touch`, `size:M`, `tag:Pilot`. Milestone L2. Depends on: E53-S30 and E53-S29. This is more than one M: keep steps 1–2 and the eval in E53-S5, and create **E53-S33 Extract and resolve every business named** for steps 3–4 (`size:M`, same labels and milestone, depends on E53-S5 and E53-S30; E53-S6 then depends on E53-S33).

Background: Elmo finds candidate mentions with whole-word patterns on name, aliases and domains, then asks Jev, through TypeSafe, whether the answer really refers to that entity and with what sentiment. Jev sees only the answer text and the entity's name and website. It has no Place ID, phone or address, and it only judges entities we already track; it doesn't list other businesses in the answer. So matching runs in this order:

Acceptance criteria:
- [ ] **1. Structured match first (no LLM):** business cards from E53-S29 matched by Place ID, Maps CID, phone (E.164-normalized) or Maps URL against the subject and tracked competitors.
- [ ] **2. Text mentions:** Elmo's pattern match plus Jev, with the location context added to Jev's question (the business's city, address and phone, as we know them), so Jev can answer `other_company` when the answer places a same-named business elsewhere. Keep this change additive in our code; label `upstream-touch` if `mention-judge/analyze.ts` has to change.
- [ ] **3. Extract every business named:** a structured-output LLM step lists all businesses in the answer text (name, any phone, address or link) so competitors we don't track yet are captured for E53-S6.
- [ ] **4. Resolve:** extracted or unmatched names go through Places Text Search with the area (E53-S30); a candidate within the area with a matching name (and phone, if the answer gives one) gets its Place ID.
- [ ] Same-name businesses in other cities are not counted.
- [ ] Each mention stores its match method (`place_id | cid | phone | url | text+jev | resolved`) and confidence.
- [ ] Mentions the judge confirms but that can't be resolved are flagged for review, not dropped.
- [ ] Eval set of at least 100 hand-labelled local mentions, including same-name businesses in other cities; precision and recall reported in Langfuse; target precision ≥ 0.95.

### E53-S29 Parse map and business cards
Labels: `story`, `area:local`, `size:M`, `tag:Pilot`. Milestone L2. Depends on: E53-S23, E53-S24 or E53-S25.

Acceptance criteria:
- [ ] Normalizes business cards from each vendor (DataForSEO local items, Cloro business data, Bright Data `business_locations`, Gemini Maps grounding chunks) into one `answer_businesses` shape: name, Place ID if any, phone, address, coordinates, rating, position.
- [ ] Card position counts toward average position.
- [ ] Fixtures per vendor.

### E53-S6 Competitor discovery per city
Existing backlog story; update rather than duplicate. Labels: `story`, `area:local`, `size:M`, `tag:Pilot`. Milestone L2. Depends on: E53-S33 and E53-S30.

Acceptance criteria:
- [ ] Businesses that recur for a service and area across runs become tracked competitors automatically (threshold configurable).
- [ ] Seeded before the first scan from Google Places Text Search for each service and area (E53-S30), so new subjects have competitors on day one.
- [ ] Competitors are per area, not brand-wide.
- [ ] I can pin or ignore a competitor.

### E53-S14 Local citation categories
Labels: `story`, `area:local`, `size:S`, `tag:Pilot`. Milestone L2.

Acceptance criteria:
- [ ] Adds `listings` (Google Business Profile and Maps URLs, Yelp, Angi, BBB, Nextdoor, HomeAdvisor, Thumbtack, Apple Maps, Bing Places, Facebook pages) and `local-news` (seed list per metro, editable) categories through an override in our code, not by editing Elmo's domain lists in place.
- [ ] Citation views and the gap report group by these categories.

---

## Milestone L3 — Local report and actions

### EPIC-L3 A local report that beats BrightLocal

Labels: `epic`, `area:report`. Body: include the scorecard below as a checklist. Close the epic only when every row is checked for the pilot subjects.

| Capability | BrightLocal | ChatSpy target | Issue |
|---|---|---|---|
| Engines | 3 | 6 (AI Mode, AIO, ChatGPT, Gemini, Perplexity, Claude) | L1 |
| Location method | Undisclosed | Tier shown per engine; canary pass rate published | E53-S22, E53-S27 |
| Sampling | Snapshot, on demand | Geo-grid × repeats with confidence intervals | E53-S21, E53-S28, E53-S32 |
| Prompts | 20 per location | Budget-limited; "near me" and city-named | E53-S4 |
| Score | Blended 0–100 | Mention rate with CI, share of voice, position, sentiment, each explained | E53-S32 |
| Business matching | Not described | Place ID and phone resolution, precision ≥ 0.95 | E53-S5 |
| Facts | — | AI answers checked against the facts API | E53-S16 |
| Actions | Citation Builder routing | Local playbook, action log and before/after re-check | E53-S15, E53-S17 |
| Prospects | — | Audits for prospects with shareable reports | E53-S8 |

### E53-S32 Local metrics with confidence intervals
Labels: `story`, `area:report`, `upstream-touch`, `size:M`, `tag:Pilot`. Milestone L3. Depends on: E53-S22 and E53-S5.

Acceptance criteria:
- [ ] Mention rate per engine, area and phrasing with a Wilson 95% interval.
- [ ] Share of voice, average position (including card position) and sentiment kept as separate metrics.
- [ ] Every metric filterable by fidelity tier; trend lines show a marker when the tier mix changes.
- [ ] Grid heat map per prompt and engine for T1/T2 routes.
- [ ] No blended score (ADR-32).

### E53-S7 Local citations and gap report
Existing backlog story; update rather than duplicate. Labels: `story`, `area:report`, `size:M`, `tag:Pilot`. Milestone L3. Depends on: E53-S14.

Acceptance criteria:
- [ ] Sources cited for competitors in the subject's area but not for the subject become a ranked list.
- [ ] Ranked by citation frequency × number of engines × competitor overlap.
- [ ] Each row shows which engines cited it and which competitors appear there.

### E53-S15 Local opportunity playbook
Labels: `story`, `area:local`, `upstream-touch`, `size:M`, `tag:Pilot`. Milestone L3. Depends on: E53-S7.

Acceptance criteria:
- [ ] Local subjects use a variant of Elmo's opportunities prompt, with categories `listings`, `reviews`, `gbp`, `local-press-community` and `service-pages`.
- [ ] Keeps Elmo's ethical rules, and adds: no review gating, no fake or AI-written reviews, no incentives tied to ratings.
- [ ] Every item cites the sources and prompts it is based on.
- [ ] Unlike the brand prompt, on-page advice is allowed for the subject's own site when facts come from the facts API.

### E53-S16 AI fact accuracy
Labels: `story`, `area:local`, `size:M`, `tag:Pilot`. Milestone L3. Depends on: E53-S4 (branded prompts).

Acceptance criteria:
- [ ] Claims in branded answers (hours, phone, service area, services offered, licensed or insured, open or closed, price ranges) are extracted and compared with the facts API (or entered facts for prospects).
- [ ] Each mismatch is shown with engine, passage and cited source.
- [ ] Eval set of at least 50 labelled claims; false-positive rate under 10%.

### E53-S17 Action log and re-check
Labels: `story`, `area:report`, `size:S`, `tag:Pilot`. Milestone L3. Depends on: E53-S15.

Acceptance criteria:
- [ ] Any opportunity, gap or fact mismatch can be marked done, with a note and date.
- [ ] Affected prompts re-run on the same routes after N days (default 14).
- [ ] The report shows before and after, with intervals.

### E53-S8 Local report pages
Existing backlog story; update rather than duplicate. Labels: `story`, `area:report`, `size:M`, `tag:Pilot`. Milestone L3. Depends on: E53-S32, E53-S7, E53-S16 and E53-S17.

Acceptance criteria:
- [ ] Shareable, revocable page per subject: metrics per engine with intervals, fidelity tier and canary rate per engine, grid maps, competitors per area, sources and gaps, fact mismatches, actions taken.
- [ ] Prospect version for audits.
- [ ] Clear wording: "API approximation" for T4/T5 engines.

### DOC-L1 Record ADR-32 and ADR-33
Labels: `docs`, `size:S`, `tag:Pilot`. Milestone L1.

Story: Add these to `docs/plan/` (the platform repo's `architecture.md` is the source; open a matching issue or note there):

> **ADR-32: Visibility metrics.** Mention rate per engine with a confidence interval is the headline; share of voice, position and sentiment are reported separately; no blended score. *Revisit when* prospects regularly ask for one number to compare with a vendor's score.
>
> **ADR-33: Location fidelity, routing and our own grid.** *Supersedes the Local Falcon half of ADR-28.* Every run records a requested location, method and fidelity tier (T1–T5). We build the geo-grid ourselves: coordinate grids for routes that take lat/lng, ZIP grids for IP-egress routes, centroids for the rest; no Local Falcon dependency. Engines in scope: Google AI Mode, Google AI Overviews, ChatGPT, Gemini, Perplexity, Claude. Grok is dropped (no terms-compatible consumer route; vendors discontinued it). Routes per engine come from the SP5-L bake-off, with canaries deciding when a route is degraded. No logged-in consumer scraping. Our own logged-out scraping only through E53-S31 after legal review. *Revisit when* a vendor loses a surface, canaries fail for two weeks, vendor cost for an engine exceeds about 3× the estimate in E53-S28, or Grok gets a vendor-supported consumer route and clients ask for it.

---

## Milestone L4 — Later (short placeholder issues with triggers)

Make each one brief: why, trigger, rough size.

- **E53-S18 Fix routing** (`size:M`, `tag:v1`): listings gaps create tasks through the GBP API or the platform's `ListingsProvider`. Trigger: the platform's E26 lands.
- **E53-S19 Sources leaderboard by service and metro** (`size:M`, `tag:v1`): cited domains across subjects through the audited agency role; no subject names in public output. Trigger: 10 or more subjects in one metro.
- **E53-S20 Free checker** (`size:M`, `tag:Later`): 3 prompts, 1 engine, cached, rate-limited, creates a prospect subject. Trigger: report pages are live and the cost per check is under $0.50.
- **E53-S31**: above.
- **E53-S11 Own the engine**: existing story; leave it alone unless the issue is missing.

---

## Sources

- Elmo source and providers guide, commit a96f1af: https://github.com/elmohq/elmo (`packages/docs/content/docs/user-guide/providers.mdx`, `packages/lib/src/providers/`)
- DataForSEO Google AI Mode SERP (location_code, location_name or location_coordinate): https://docs.dataforseo.com/v3/serp/google/ai_mode/live/advanced/
- DataForSEO ChatGPT LLM Scraper and locations: https://docs.dataforseo.com/v3/ai_optimization-chat_gpt-llm_scraper-live-advanced/ · https://docs.dataforseo.com/v3/ai_optimization/chat_gpt/llm_scraper/locations/
- DataForSEO Gemini LLM Scraper (location_coordinate): https://docs.dataforseo.com/v3/ai_optimization/gemini/llm_scraper/task_post/
- Cloro AI Mode city targeting: https://docs.cloro.dev/api-reference/endpoint/monitor-aimode · state targeting: https://cloro.dev/blog/ai-search-results-by-state/ · Grok discontinued: https://cloro.dev/grok/
- Bright Data ChatGPT scraper (geolocation field, business_locations): https://brightdata.com/products/web-scraper/chatgpt · https://docs.brightdata.com/products/scrapers/chatgpt/send-first-request · proxy city/ZIP targeting: https://docs.brightdata.com/api-reference/proxy/geolocation-targeting
- Census ZCTA gazetteer files (public domain): https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html
- Perplexity user location filter: https://docs.perplexity.ai/guides/user-location-filter-guide
- Anthropic web search tool user_location: https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
- Gemini API grounding with Google Maps: https://ai.google.dev/gemini-api/docs/maps-grounding
- Places API policies (Place ID exempt from caching): https://developers.google.com/maps/documentation/places/web-service/policies · Place IDs (refresh guidance): https://developers.google.com/maps/documentation/places/web-service/place-id
- ChatGPT search and location: https://help.openai.com/en/articles/9237897-chatgpt-search
- OpenAI terms of use: https://openai.com/policies/terms-of-use/
- BrightLocal Local AI Visibility: https://www.brightlocal.com/local-seo-tools/local-ai-visibility/ · metrics: https://help.brightlocal.com/hc/en-us/articles/37990220496018-What-does-each-Local-AI-Visibility-metric-mean