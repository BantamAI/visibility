# Grid scans

A grid scan runs one prompt on one route across every active point of one kind in a service area, as one run per point and repeat. Grid scans run what the run planner plans (`docs/local/run-planner.md`); they make no routing decisions of their own.

## What a scan covers

Each planned series is split into one scan per area and prompt. The route decides the point kind: coordinate routes get the coordinate grid and centroids as separate series, city-level and T5 routes get centroids only, and an egress route would get ZIP points. Points the route can't place go on the scan as uncovered, each with the nearest city in its area standing in for it, or as a gap when there's none. They add no runs.

A scan stores its prompt, route, tier, point kind, repeats and an estimated cost (points × repeats × the route's cost per run) when it starts. The Run Plan page shows each series' cost per scan before the schedule is enabled, and lists recent scans with their coverage and cost.

## When scans start

The `start-grid-scans` job runs every 15 minutes. For each subject with an enabled schedule, it checks the plan against the budget again, because prompts or areas added since the schedule was saved can push it over. A plan over budget starts nothing and raises a Sentry warning. Otherwise it starts each scan whose series has never run, or last started at least its interval ago. A scan may start up to an hour early, so a weekly scan doesn't slip a tick later each week. A new route for an engine is a new series, so it starts at once. A vendor stopped for overspending starts no scans until it's resumed (`docs/local/vendor-spend.md`).

## Running

Each run is its own `grid-scan-run` job, so a failure retries that run alone and doesn't pay for the others again. Jobs are grouped by vendor, and the queue limits how many of each vendor's runs are in flight across every worker (`VENDOR_CONCURRENCY`).

A run is saved the same way as any located run (`docs/local/run-locations.md`), and the scan run is marked answered in the same transaction. A run that fails is retried up to three times on the same route. A refused location fails at once, since a retry wouldn't change it, and nothing was spent. A run that still fails is recorded as failed, with its last error.

When no run is left pending, the scan completes with its coverage (points with at least one answer ÷ points planned) and its cost (the sum of its answered runs' costs). A scan doesn't fail as a whole. Each tick also completes scans more than six hours old whose jobs were lost, failing the runs that never settled.

## Results

`getScanResults` returns every point of a scan with its location, each repeat's status, answer text and cited sources, for the heat maps in E53-S32. Uncovered points return their stand-in's runs, and gaps return none. Answers and citations appear once the run is judged, shortly after it's saved. Ranked businesses will come from E53-S29.
