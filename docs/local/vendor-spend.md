# Vendor spend stops

A planner bug, a retry storm or a vendor price change can't run up more than a bounded bill: a vendor whose spend for the day runs past twice its plan is stopped until agency staff resume it.

## Plan and spend

A vendor's plan for the day is the estimated cost of every scan on it, across every subject with an enabled schedule that fits its budget, as if all of them started that day. No schedule interval is shorter than a day, so that's the most a day can legitimately cost. A vendor with spend but no plan has no allowance at all: nothing enabled should have spent there.

Spend is the sum of `usage_events.estimated_cost_usd` for the vendor since midnight UTC, counting failed runs too, since some vendors bill them. Runs record the vendor's reported cost when it gives one and the estimate in `packages/lib/src/usage/cost.ts` otherwise.

## Stopping and resuming

The `check-vendor-spend` job runs every 5 minutes. A vendor past `OVERSPEND_FACTOR` (2) × its plan gets a row in `vendor_spend_stops` and a Sentry error. While stopped:

- No run on that vendor calls it: `runModelIteration` throws `VendorStoppedError` before spending anything.
- Its due scans don't start; they start once it's resumed.
- A queued scan run fails at once, with no retry, and becomes a gap in its scan.

Only staff lift a stop, with Resume on the admin Vendor Spend page, which also shows each vendor's spend, plan and limit for the day. Spend before a resume no longer counts that day, so the vendor gets a fresh allowance of twice its plan.

`vendor_spend_stops` is agency-only. Subject-scoped work can read it, to check a vendor before spending, but can't stop or resume one.
