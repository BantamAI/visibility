# Local opportunity playbook

Elmo's Opportunities page is written for content marketers. A subject with a service area gets a local playbook on the same page instead, built from its located answers. A subject with no service area keeps Elmo's report. The API and MCP serve whichever one the page shows.

## What it reads

One LLM call, with no web search, reads a digest of the last 30 days of the subject's located runs whose local mentions have been matched (`docs/local/local-mentions.md`). Each service area gets its own section:

- mention rate by engine, with its Wilson 95% interval (`docs/local/local-metrics.md`)
- the source mix by citation category, Listings and Local News included (`docs/local/citation-categories.md`)
- the 15 prompts with the widest gap between the subject and the area's most-named tracked competitor, with the domains their answers cite
- the area's top 10 citation gaps (`docs/local/citation-gaps.md`)
- the domains cited when the subject is named, and competitors' own sites cited, for context

## Categories

| Category | What it covers |
|---|---|
| Listings | Claiming, completing and correcting a profile on a directory or map listing answers cite |
| Reviews | Earning genuine reviews on the review platforms answers cite |
| Google Business Profile | Categories, services, service area, hours, photos, posts and Q&A on the profile |
| Local Press and Community | Local news, community sites, associations and events |
| Service Pages | The subject's own pages for each service and city |

## Rules

The prompt keeps Elmo's rules: no editing the subject's own Wikipedia entry, no fake, incentivized or undisclosed reviews, no astroturfing or sock puppets, and nothing expensive as the main action. It adds three rules for reviews: no review gating (every customer is asked the same way), no fake reviews or reviews written by AI, by staff or for customers, and no incentive tied to a rating.

**Every opportunity is grounded.** The model names the domains and tracked prompts each one is based on. Only domains and prompts the digest showed it count. An opportunity left with no source or no prompt is dropped. Each card's Sources tab lists those domains with the pages the subject's answers cite most.

**On-page advice needs facts from the facts API.** Elmo never advises on-page changes, since it can't see page contents. The playbook may, for the subject's own site only, when its facts come from the platform's facts API. The facts are then put in the prompt, and any on-page advice may use only them. Without them, an opportunity marked as on-page is dropped, and a Service Pages opportunity can only be a new page. The facts API client isn't built yet (platform E53-S9), so until it is, no subject gets on-page advice. Facts staff enter by hand, such as a contact's phone and address, don't count.

## Refresh and cost

A playbook is kept for 6 days, like Elmo's, then regenerated the next time the page or API asks for it. If regenerating fails three times, the last playbook is served. Each LLM call, valid or not, is recorded in `usage_events` as `local_opportunities`. A subject whose areas have no matched answers in the window gets the not-enough-data message.

Playbooks are stored in Elmo's `brand_opportunities` with `variant: "local"`, so an Elmo report stored before a subject had an area is never served as a playbook.
