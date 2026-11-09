# SP5-L location fidelity results

Run on November 8–9, 2026. Plumbing prompts were asked from three service areas: Raleigh, NC and Denver, CO (metros, 10-mile radius) and Naperville, IL (suburb, 6-mile radius). Each area had five sample points (center plus 6 miles north, east, south and west, or 4 miles for Naperville). Five intents were asked "near me" and city-named, plus "what city am I in right now?". The harness is `packages/lib/scripts/location-probe/`.

Every route went through a screen first: two near-me prompts and the calibration prompt from each center, and calibration from every spoke on coordinate routes. Only routes that passed got the full run (near-me prompts at every point, two repeats, and city-named prompts at the centers).

## How a route was judged

- **Canary:** E53-S27's distance rule. An answer passes when the median distance from the point to the businesses it names, placed on Google Maps, is within the area's radius.
- **Stated location:** where the answer says the user is ("based on your location in…"), checked against the point.
- **Maps reference:** the share of an answer's businesses that Google Maps also lists for "plumber" at that point.
- **Points vs repeats:** overlap between answers from different points against overlap between repeats at one point. A route that uses the point overlaps less across points.

A business is placed by searching Maps near the area's center, so a national chain resolves to its local branch. That flatters the canary for routes that ignore the location, which is why stated location and the Maps reference decide alongside it.

## Chosen route per engine

| Engine | Route | Tier | Fallback | Cost per 1,000 runs |
|---|---|---|---|---|
| Google AI Mode | DataForSEO AI Mode SERP, `location_coordinate` as `lat,lng,15z` | T1, point level | Cloro `location` (Google canonical name), T1 city level, centroids only | $4.00 live, $1.20 standard queue |
| Google AI Overviews | DataForSEO organic SERP, `location_coordinate` as `lat,lng,radius`, `load_async_ai_overview` | T1, point level | SearchApi `latitude`/`longitude` (T1, needs a paid plan); Cloro `location` (city level) | $2.90 measured (up to $4.00) |
| Claude | Anthropic API web search `user_location` plus the system prompt (E53-S26) | T4, API approximation | none | about $40 (12.9k input and 1k output tokens plus one search a run; check the console) |
| ChatGPT | none below state | label approximate | city-named prompts only (T5) | – |
| Gemini | none | label approximate | city-named prompts only (T5) | – |
| Perplexity | none working during the run | label approximate | retry Cloro `state` once its Perplexity outage clears | – |

### Full-run numbers (near-me prompts)

| Route | Answered | Canary pass (n) | In-area share | Stated correct (n) | Maps reference | Points vs repeats | City-named canary | p50 / p95 s |
|---|---|---|---|---|---|---|---|---|
| AI Mode via DataForSEO | 100% of 195 | 89% (149) | 81% | 95% (191) | 47% | 9% vs 40% | 100% | 10 / 20 |
| AI Overviews via DataForSEO | 71% of 195 | 90% (39) | 81% | 95% (62) | 57% | 2% vs 15% | 87% | 9 / 48 |
| Claude via Anthropic API | 100% of 63 | 77% (30) | 62% | 100% (60) | 27% | – | 73% | 9 / 10 |
| Gemini via Cloro `state` | 100% of 18 | 38% (13) | 38% | 0% (12) | 11% | – | – | 161 / 293 |

Google AI Overviews show no overview, or one that names no business, on most of these prompts: only 41% of answered runs named a plumber. DataForSEO also returned `40101 Internal SE Server Error` on 130 attempts. The adapter's retries cleared some, but it needs more retry headroom for located runs.

## Grid sensitivity

A 5×5 grid over Raleigh, 3 miles apart, two near-me prompts and two repeats per point:

| Route | Repeats at one point | 3 mi | ~4 mi | 6 mi | ~7–9 mi | 12+ mi |
|---|---|---|---|---|---|---|
| AI Mode via DataForSEO | 31% | 25% | 21% | 19% | 16% | 10% |
| AI Overviews via DataForSEO | 40% | 20% | 27% | 18% | 19% | 13% |

AI Mode's answers drift steadily with distance, but neighbours 3 miles apart overlap nearly as much as repeats at one point do. **Default to a 3×3 grid with points about 5–6 miles apart.** Use a 5×5 grid only for areas wider than about 20 miles. AI Overviews answered too rarely to set the spacing on its own.

## Rejected routes

| Route | Why |
|---|---|
| ChatGPT via Bright Data `geolocation` | Ignored. Answers said the user was in Phoenix, Baltimore, Livonia and other places unrelated to the point (0 of 19 correct); canary 17%. The field appears only in the vendor's samples, and the scraper refuses `country: "us"`. |
| ChatGPT via DataForSEO `location_coordinate` | Accepted, then ignored. Answers came from the vendor's egress (Ashburn VA, Dallas, Minneapolis); 0 of 21 correct. The ChatGPT scraper's location list holds only countries. |
| ChatGPT via Cloro `state` (T3) | Lands in the right state but not the right metro (Durham and Greenville NC for Raleigh, Collbran CO for Denver); canary 0%. |
| Gemini via DataForSEO, coordinates or city name | Gemini answers as if it has no location ("I don't have access to your location") and lists businesses across several regions. |
| Gemini via Cloro `state` (T3) | Inconsistent: Chicago for Naperville, Charlotte and Spruce Pine for Raleigh; canary 38% over the full run, 10-minute answers. |
| Perplexity via Cloro `state` | Cloro's Perplexity endpoint was down ("unable to access Perplexity with logged-out sessions"). Not a verdict on the route; retry it. |
| Perplexity via Bright Data | The dataset refuses `geolocation`, and all 9 country-level runs timed out after 12 minutes. |
| Perplexity via SearchApi | SearchApi has retired its Perplexity API. |
| AI Mode via SearchApi `location`, AI Overviews via SearchApi `latitude`/`longitude` | Both passed the screen (every stated location correct). Not chosen because DataForSEO covers both surfaces at the point level and SearchApi needs a monthly plan. They remain the second fallback. |

ChatGPT and Gemini localize from the IP address a run comes from, not from fields a vendor forwards. The only way to T2 for them is a residential exit in the point's city on the consumer surface, which means our own logged-out scraper (E53-S31, behind legal review) or a vendor that sells city-level egress for these engines. Until then they run city-named prompts only and are labelled approximate.

## Residential proxies for small towns

Before deciding on a scraper of our own (E53-S31), we checked whether city-targeted residential exits can reach small towns. Eight New Hampshire ZIP codes were picked at random across population sizes. For each, we asked Oxylabs' residential pool for an exit by ZIP and by a 10-mile coordinate radius, and asked three IP geolocation databases where the exit was.

| ZIP area | Population | Exit by ZIP | Where the databases put it |
|---|---|---|---|
| Waterville Valley | 510 | none | – |
| Hebron | 953 | none | – |
| Hill | 1,076 | none | – |
| North Hampton | 4,597 | none | – |
| Littleton | 6,005 | yes | Littleton (all three agree) |
| Belmont | 7,368 | none | – |
| Merrimack | 26,622 | yes | Londonderry NH, Cupertino CA, Point Pleasant Beach NJ |
| Manchester | 33,396 | yes | Manchester or Londonderry NH; one database said Cambridge MA or New York |

Coordinate targeting found no exit anywhere, even at a 25-mile radius around Manchester. City-name targeting takes no state, so "Plymouth" exited in Michigan.

A real home connection, in a logged-out private window, shows the ceiling even a perfect exit would hit. ChatGPT put the user in a city about 140 miles away. Gemini named the exact town, so Google's own IP location is far better than the commercial databases above. Perplexity didn't say where the user was. Claude.ai can't be used logged out, which doesn't matter because Claude goes through the API.

Oxylabs' AI scrapers take a country code only (`location`, ISO 3166-1 alpha-2); state, city and ZIP values are rejected. With `US`, ChatGPT placed the user in Monmouth, OR. Its Perplexity jobs didn't finish within 10 minutes.

**Decision:** residential egress can't place a run in an arbitrary small town. Five of eight random ZIPs had no exit. ChatGPT misplaces even a genuine local home IP, and Perplexity doesn't use one. Gemini would follow an exit's IP, but only in towns that have one. ChatGPT, Gemini and Perplexity therefore run city-named prompts only, labelled as an approximation, and E53-S31 isn't worth building for location. Revisit for Gemini alone if a proxy vendor shows exits in most small-town ZIPs.

## Not run

- NodeMaven vs Bright Data and the BrightLocal comparison were dropped from scope.
- Canaries were checked by the scorer, not by hand.
