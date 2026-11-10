# Local prompt templates

A local subject's prompts come from templates rather than being typed in, so every business of one kind is asked the same questions and the answers can be compared. Generate them on the brand's **Local Prompts** settings page.

## What's generated

Services are what the business sells, written as people search for it ("plumber", "roofer"), and are added on the Local Competitors page (`docs/local/competitor-discovery.md`). A job is a specific task under a service ("water heater replacement"), up to 5 per service, stored on the service (`subject_services.jobs`).

Every service is asked with all four intents, always:

| Intent | Template |
|---|---|
| `emergency` | I need an emergency {service} {place}. Who should I call? |
| `cost` | How much does a {service} {place} charge? |
| `best` | Who is the best {service} {place}? |
| `reviews` | Which {service} {place} has the best reviews? |

Each job adds `Who can I hire for {job} {place}?` (intent `job`).

Each of these is asked once with `{place}` as "near me", and once more for each city you pick ("in Raleigh, NC"). The cities are each area's centroid cities. The one nearest the area's center is its main city, and it's picked to start with. **Main Cities Only** goes back to that.

Two branded prompts check the business's facts for E53-S16, asked once in the primary area's main city: `Is {business} in {city} licensed?` and `What are the hours for {business} in {city}?`.

So a subject has (services × 4 + jobs) × (1 + cities picked) + 2 prompts. Three services with six jobs and three cities come to 74.

## Tags

| Tag | Meaning |
|---|---|
| `unbranded` / `branded` | Type, using Elmo's own override tags so the branded filter agrees |
| `service:<service>` | The service, which competitor discovery counts runs by |
| `intent:<intent>` | `emergency`, `cost`, `best`, `reviews`, `job`, `licensed` or `hours` |
| `near-me` / `city-named` | Phrasing |
| `city:<city>-<state>` | The city a city-named prompt names, such as `city:raleigh-nc` |

## Where they run

"Near me" prompts run on every area's grid and centroids (`docs/local/run-planner.md`), so they don't multiply by area. A prompt tagged `city:` runs only at that city's centroids. When the route can't place that centroid, it runs at the centroid standing in for it. A city-named prompt is never run in another city's area.

## Limits

There's no 20-prompt cap per location. A brand still can't have more than Elmo's 100 prompts, and the page won't add prompts past that. It also prices the run plan with the new prompts. When the schedule is enabled and they'd take it over the budget, the page won't add them, because a plan over budget starts no scans. With the schedule off, it shows the cost and adds them.

Prompts already added (the same text, ignoring case and spacing) are skipped, so the page can be run again after adding a service, a job or a city. Removing a service or job doesn't remove its prompts. Delete them on the Prompts page.
