# Local citation gaps

The sources AI engines cite when they name a subject's competitors, but never when they name the subject, are the most direct to-do list an agency gets. The **Local Citation Gaps** card on the Citations page lists them for one service area at a time. It's hidden for a subject with no service area. Elmo's Content Gaps card beside it is brand-wide and works by prompt; this one works by source and area.

## What counts

The card reads the area's located runs in the page's period, filtered by its tags and engine. A run counts toward the area when its sample point is in that area.

- A run **names a competitor** when one of the area's tracked competitors (`docs/local/competitor-discovery.md`) has a counted row in `local_mentions` (`docs/local/local-mentions.md`). Competitors tracked only in other areas, and namesakes ruled out, don't count.
- A run **names the subject** when the subject has a counted row.
- A source is a cited domain. It's a gap when at least one run naming a competitor cites it, and no run naming the subject cites it, in the same area and period.

The subject's own sites, Elmo's competitors' domains and tracked competitors' websites aren't sources to win, so they're left out. Each source shows the category it's most often cited as, Listings and Local News included (`docs/local/citation-categories.md`).

## Ranking

Each source scores:

> answers naming a competitor that cite it × engines among those answers × competitors named in those answers

So a source three engines cite for two competitors beats one a single engine cites more often for one. Ties go to the source with more answers, then by name. Each row lists its engines, each competitor with how many of those answers name it, and the three pages of the source those answers cite most.

An area with no tracked competitors has nothing to compare against. The card says so and links to the Local Competitors page.

## Caveats

A competitor named in an answer that cites a source is a stand-in for the competitor appearing on that source. Nothing fetches the source to check. An answer naming both the subject and a competitor counts for both, so every source it cites is off the list.
