# Local mentions

Name matching alone can't tell a subject's plumber from a same-named business in another town, and it misses businesses that appear only as cards. Each located run's answer is matched to the subject and its tracked competitors in `local_mentions`: one row per business the answer names or shows a card for, with how it was matched, how sure the match is, and whether it counts.

## How a business is matched

1. **Cards first, no LLM.** A card in the answer (`docs/local/answer-businesses.md`) is the business when it carries the business's Place ID or Maps CID (`docs/local/place-ids.md`), its phone, or a page of its website. A website with a path matches only pages under it, so a franchise's page for another city doesn't. A card with a Place ID or CID other than the business's own is another listing, whatever else it shares.
2. **Then the judge.** Elmo's whole-word name match finds the businesses the text names, and Jev judges whether each is meant. For a local subject, Jev's question says where the business is (below), so it can answer `other_company` when the answer places a namesake elsewhere.
3. **Then the cards that share the name.** A text match the judge confirms is checked against the answer's cards that name the business:
   - A card whose name starts with the business's name and whose ZIP is near the subject's areas is another listing of the business, such as a second location or a chain's other branch in the market. The mention counts.
   - A card of that name placed elsewhere, or with another listing's ID and no address, is a namesake. So is a card where the name sits inside a longer one ("Harris Brothers Plumbing" for "Brothers Plumbing"). The mention doesn't count.
   - With no such card, the mention counts only when the judge is sure of it (probability at least 0.8).

Only cards in the answer are matched. The map pack beside an AI Overview is Google's ordinary local ranking, not the AI's.

"Near" means the Census point of the card's ZIP (`ref_us_zctas`) is within 1.5 times the radius of one of the subject's areas, because businesses just outside an area still serve it. A card without a ZIP, or with one not in the table, can't be placed.

| Method | Confidence | Counts |
|---|---|---|
| `place_id` | 1 | Yes |
| `cid` | 1 | Yes |
| `phone` | 0.95 | Yes |
| `url` | 0.9 | Yes |
| `text+jev` | Jev's probability | As above |
| `resolved` | – | Set by E53-S33, which resolves unmatched names through Places |

A matched card's placement and position are stored with the row, so card position counts toward average position.

### Rows flagged for review

Nothing the judge confirms is dropped. Rows that need a person's eye carry a `review` reason:

| Review | Counted | Meaning |
|---|---|---|
| `unresolved` | Yes | The judge is sure, but nothing ties the name to the business's listing. E53-S33 resolves these. |
| `doubtful` | No | The judge couldn't rule the name out but isn't sure of it. |
| `other_listing` | Yes | Counted for a card of the same name nearby that isn't the anchored listing. |
| `namesake_card` | No | Ruled out by a namesake's card. |

Elmo's own `run_mentions` still counts a name the judge can't rule out, by design, so Elmo's dashboards are unchanged. Local reports read `local_mentions`.

## What the judge is told

A subject with at least one service area is local. Its Jev question, and each tracked competitor's, adds where the business is:

> It's the business of that name serving Raleigh (Raleigh, NC; Garner, NC; Knightdale, NC), at 1 Main St, Raleigh, NC, phone (919) 555-0100.

The areas come first by primary, each with up to eight of its city centroids, nearest its center first. Competitors are described with the subject's areas, since tracked competitors compete in the same market, plus their own phone and address. Phone numbers are shown as answers write them.

Brand-mode subjects (no service area) are asked exactly what Elmo asks, and their mentions stamp is unchanged, so their history isn't re-judged. A local subject's stamp includes its whereabouts: adding an area or changing a phone or address re-judges that subject's history, which costs Jev calls.

## Phones and addresses

Enter the phone and address of the subject and each competitor on the brand's **Place IDs** settings page (Edit Contact). Use what the business publishes. Google's policy doesn't let a Places response's phone or address be stored. Phones are stored in E.164 and matched against card phones; both go into the judge's question. Linked clients will get theirs from the platform's facts API. Competitors are keyed by name, as their Place IDs are.

## When matching runs

Matching needs both a run's cards and its judgement. Every 5 minutes, `derive-local-mentions` matches up to 2,000 located runs per subject, newest first. It picks runs never matched, and runs whose judgement, cards, or anything matching reads has changed since: the businesses' names, aliases, websites, anchors, phones and the subject's areas. `run_locations.local_mentions_stamp` records what each run was matched against. A change to matching bumps `LOCAL_MENTIONS_VERSION`, and every located run is matched again.

## Evaluation

`packages/service/scripts/local-matching-eval/` holds an eval set of 132 hand-labelled items from 57 SP5-L answers (Raleigh, Denver and Naperville; AI Mode, AI Overviews, Claude and Gemini). Each area is set up as a subject tracking six businesses it names often, anchored on Place IDs found with Places Text Search. Each answer is judged as its own area's and as another area's, so chains (Roto-Rooter, Mr. Rooter, Benjamin Franklin) and names such as "Blanton" and "Brothers Plumbing" appear as businesses of the same name elsewhere. Each label was checked by reading the passage; judgement calls carry a note in `dataset.json`.

`run.ts` calls Jev for real and scores three setups:

| Setup | Precision | Recall |
|---|---|---|
| Elmo's judge (name and website only) | 0.561 | 1.000 |
| Judge told where the business is | 0.860 | 1.000 |
| Local matching (cards, then that judge) | 0.961 | 1.000 |

Run on November 9, 2026. The three remaining false positives are a Roto-Rooter franchise in the Denver area counted as the tracked company-owned branch, a bare "Roto-Rooter" in a Naperville answer judged as Denver's, and a plumber named Duane Blanton taken for J. Blanton Plumbing.

Caveats:

- The 0.8 bar and the nearby-listing rule were set after seeing this set's errors, and there's no held-out set yet. Add answers from new areas and scans before trusting the figure further.
- No phones were entered for the eval's businesses, so phone matching isn't exercised. Every card match was by CID.
- Langfuse isn't wired into this repo, so results are recorded here rather than there.

To rebuild the set (it keeps existing labels) or rerun the scores, from `packages/service`:

```sh
pnpm exec tsx --env-file=../../.env scripts/local-matching-eval/build.ts ../lib/scripts/location-probe/out/runs.jsonl
pnpm exec tsx --env-file=../../.env scripts/local-matching-eval/run.ts
```

New items are labelled `proposed` until checked.
