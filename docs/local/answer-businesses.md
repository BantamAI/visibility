# Answer businesses

Local answers often show businesses as cards (name, rating, phone, address, a Maps link) rather than only naming them in text. Cards carry IDs and phone numbers that text matching can't see, so every located run's cards are read into `answer_businesses` in one shape, whichever vendor fetched the answer.

## What a card holds

Name, Google Place ID, Maps CID, phone (E.164), address, coordinates, rating, review count, website, and its placement and position.

- **Placement** says where the card sat: `answer` for cards inside the AI answer, `local_pack` for the search page's map pack beside an AI Overview. The map pack is Google's ordinary local ranking, not the AI's, so it's kept apart.
- **Position** is 1 for the first card in its placement, in the order shown. Average position in the local report counts card positions once cards are matched to the subject and its competitors (E53-S5).
- A Place ID is stored only when the response gives a real one (`ChIJ…`). Cloro and SearchApi also return Knowledge Graph ids (`/g/…`), which aren't Place IDs and are dropped. The CID comes from the vendor's field or from a Maps link: either `cid=…`, or the second half of the feature id in a directions link (`0x…:0x…`, in hex).
- Fields a vendor doesn't give are null. Websites that are Google redirects are dropped.

## Where each vendor puts its cards

| Vendor | Surface | Answer cards | Map pack |
|---|---|---|---|
| DataForSEO | Google AI Mode, AI Overviews | Only in the overview's markdown, as header lines above a `Call[Directions](…) [Website](…)` line | Organic SERP `local_pack` items, sponsored ones skipped |
| DataForSEO | ChatGPT scraper | `chat_gpt_local_businesses` items | – |
| Cloro | Google AI Mode, AI Overviews, ChatGPT | `map` (or `places`, which lacks coordinates) | `localResults` on the Google task |
| SearchApi | Google AI Mode, AI Overviews | `local_results` in the answer | The SERP's own `local_results` |
| Bright Data | ChatGPT | `business_locations` (or `map`, which has less on each card) | – |

DataForSEO's AI Mode route is T1 for most located runs, and it returns no structured cards: they exist only in the markdown. In SP5-L's 316 AI Mode runs, 268 had cards, about four each, and every one parsed. A card with no reviews has no rating, and its category then shares the name's line ("Colorado Water Works Plumber"); the parser strips a category the answer's other cards show.

Claude, Gemini and Perplexity answers showed no cards in SP5-L. Oxylabs and Olostep answers aren't parsed, because no located route uses them.

## When cards are derived

Cards are derived from the run's stored `raw_output`, never from a second vendor call. The worker reads a scan run's cards right after it saves the answer. Every 5 minutes, `derive-answer-businesses` also reads up to 2,000 located runs, newest first, whose cards were never derived or were derived by an older parser (`run_locations.businesses_version`). A parser change bumps `ANSWER_BUSINESSES_VERSION`, and the sweep then rebuilds every located run's cards a tick at a time. A run the parser fails on keeps the cards it had, and the failure goes to Sentry.

Scan results (`docs/local/grid-scans.md`) list each run's cards, answer cards first.

Cards are matched to the subject and its competitors in `docs/local/local-mentions.md`.
