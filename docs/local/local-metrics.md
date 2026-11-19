# Local metrics

The **Local Visibility** page reports how often AI answers in a subject's service areas name it. It shows four metrics side by side and never blends them into one score (ADR-32), because a blended score hides which metric moved and how sure the figure is. A subject with no service area sees a link to the Service Areas page instead.

## What counts

The page reads the subject's located runs (`docs/local/run-locations.md`) in its period, filtered by tags, engine, area and fidelity tier. A run counts only once its local mentions have been matched (`docs/local/local-mentions.md`). A run still waiting to be matched is left out, not counted as not naming anyone. An answer names a business when that business has a counted row in `local_mentions`, so namesakes the matcher ruled out don't count.

## The metrics

- **Mention rate** is the share of answers that name the subject. It's shown overall and per engine, per area and per phrasing ("near me", city-named, or other for prompts written by hand, read from the prompt template tags in `docs/local/prompt-templates.md`). Each rate has a Wilson 95% interval. Unlike the normal approximation, the Wilson interval stays inside 0–100% and stays honest when there are few answers or the rate is near 0 or 100%. Each answer is treated as an independent trial. Repeats at the same point are more alike than that, so the true uncertainty is somewhat wider than shown.
- **Share of voice** is Elmo's definition: the subject's mentions over its own plus its tracked competitors' mentions, one per answer each. Only competitors tracked in an answer's own area count (`docs/local/competitor-discovery.md`).
- **Average position** is over the answers that name the subject and rank it. A matched card's position comes first (`docs/local/answer-businesses.md`). Without one, the judge's rank of the subject among the tracked businesses the answer names is used. The card shows how many positions came from cards.
- **Sentiment** is the mention judge's sentiment toward the subject, over the answers that name it. An answer that shows the subject only as a card, which the judge didn't read as a mention, has none. The positive share has its own interval.

## Trend and tier mix

The weekly trend plots the mention rate with its interval as a band. Weeks run Monday to Sunday, UTC. A week is marked when any tier's share of its answers moves by 20 points or more from the last week with answers. Its rate then rests on different routes, so a change may come from the method rather than the market. Filtering to a single tier removes the markers, since the mix can't change.

## Grid heat maps

The heat map shows one grid scan (`docs/local/grid-scans.md`): the latest scan of each prompt on each engine in the period, for T1 (exact point) and T2 (city exit) routes only. Other routes don't answer from the point itself, so a map of them would show the same answer at every point. Each point is colored by the share of its answers that name the subject. Its number is the subject's average position there. A point the route couldn't place shows its stand-in city's answers with a dashed outline. One with no stand-in is marked as not covered. Answers that failed, haven't come back or haven't been matched don't count toward a point's rate.
