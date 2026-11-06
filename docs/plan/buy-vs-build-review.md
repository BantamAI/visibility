# Buy vs. build review and system boundaries

Nov 5, 2026 · decisions recorded as ADR-26 to ADR-31 in architecture.md; stories updated in backlog.md

## Summary

Buy commodity layers now, build the parts that set the product apart, and write down for each bought piece what would make it worth building ourselves for margin. The product is also split into separate systems with clear owners. The MakerKit monorepo is **the platform**, not the whole product.

- **Time.** Planned work through Core v1 goes from about 165 to about 134.5 focused days. That includes the two new ADR-25 tenancy stories and about 3 days for the visibility service boundary (contracts plus RLS). Core v1 moves from weeks 33–40 to about weeks 27–32. Phases 3–6 go from about 285 to about 209 days. About 84 days of build-later work is held back until a trigger fires.
- **Cost to serve.** A typical Growth client goes from about $100–$190 a month to about $135–$210, mostly because of the voice platform. Gross margin at $399 is about 47–66% instead of 55–75%. Building the voice pipeline ourselves (E55) wins most of that back once volume justifies it.
- **Systems.** In the wedge there are two codebases: the platform (MakerKit) and a separate visibility service (the Elmo fork plus our local layer). Voice runs on a hosted platform that the platform repo configures. Client sites run on a bought builder. A Python voice runtime and our own site builder become separate repos only if their build-later triggers fire.

## How each piece was judged

1. **Differentiator or commodity?** Clients pay for AEO expertise and gap reports, FSM-native booking and review triggers, compliance, transparent cost, and later the analyst. Real-time audio turn-taking, OAuth token refresh, geo-grid scraping, listing distribution and website hosting are commodity.
2. **Days saved vs. dollars per client.** At 5–20 clients, a focused day is worth far more than a few dollars per client per month. The question is when that flips, and each buy records the point where it does.
3. **Rules that don't bend still apply to vendors.** No vendor sends SMS, email or calls outside the send gate. The tenant is always resolved on our side, never from a vendor or model field. Any vendor data we depend on is copied into our own database. License rules are unchanged.
4. **Exit path.** Every bought piece sits behind an interface we own (`VoiceAgentProvider`, `VisibilityProvider`, `TelephonyProvider`, `CrmAdapter`, the listings and site adapters) and has a written build-later trigger.

## System boundaries (ADR-31)

### The systems

| System | Owns | Codebase and runtime | Users |
| --- | --- | --- | --- |
| **Platform** | Tenancy and every client login; system of record for the contact index, consents, conversations, calls, reviews, usage and canonical facts; send gate; tool gateway; connectors; inbox; dashboards; later the analyst | `platform` repo (MakerKit Turborepo): Next.js on Vercel, Hatchet workers on Fly, Supabase | Agency staff, client owners and staff |
| **Visibility** | Prompt sets, AI answers, geo-grid scans, citations, competitor sets, gap analysis, AEO reports for clients **and prospects** | `visibility` repo: Elmo fork (MIT, rebranded) plus our local layer; its own Postgres and job runner; Fly | Agency staff; public, revocable report links |
| **Voice runtime** | Live phone conversations; nothing authoritative | Hosted (Retell) now, configured from `platform/packages/voice-agent`; a `voice-runtime` repo (Python, Pipecat or LiveKit) only when E55 triggers | Callers |
| **Client sites** | Site page content | White-label builder (Duda-class) now, so no code beyond our snippets; a `sites` repo only if its trigger fires | Website visitors |
| **Tracking snippet and ingest** | First-party attribution capture on any client site | `platform/packages/tracking`, published to a CDN as a versioned public contract; the ingest route runs on its own subdomain in `apps/web` and moves to an edge deployable in Phase 6 | Website visitors |

**Outside the product:** the agency's marketing site, internal ops automations (n8n, internal use only, per its license) and my own sales pipeline. These may call platform APIs like any integration. They never live in the platform repo.

### Why the lines fall where they do

- **Visibility is its own system.** It's built on a third-party codebase we want to keep syncable with upstream. It serves prospects, who must never become tenants just to receive an audit. Its batch workloads and raw answer volume don't belong in the operational database or its backups. It can also be sold before a client has any platform account. This replaces ADR-24's plan to extract Elmo's engine into the platform: the engine grows inside `visibility` instead.
- **Voice is its own system.** It's hosted today, and if it's ever self-built it will be Python with a real-time workload. The contract is the tool manifest the gateway publishes (JSON Schema, MCP-compatible). Neither a monorepo nor shared code generation is needed.
- **Sites are their own system.** They are public, high-traffic and on custom domains, and must never hold platform database credentials. They read facts through a published read-only API.
- **Workers stay in the platform repo as a separate deployable.** Same language, same database and domain types, but a different scaling profile and blast radius.
- **Connectors, inbox, CRM adapters, the review engine and the analyst are modules inside the platform.** They write the system of record and must sit behind RLS and the send gate.
- **Boundaries cost something.** Each one is a contract to version and an integration to test. The wedge has two codebases and no more.

### Data ownership

| Data | System of record | Copies |
| --- | --- | --- |
| Tenants, users, roles | Platform | — |
| Contact index, consents, conversations, calls, transcripts, recordings, reviews, usage | Platform | Voice platform holds call data only transiently (retention set to minimum) |
| Jobs, quotes, invoices, client CRM records | Client's FSM/CRM, or the platform's native CRM when chosen | Revenue events in the platform |
| Canonical facts (hours, services, prices, areas, licenses) | Platform (`kb_facts`) | Pushed to listings vendor and voice agent tools; read by visibility and sites through the facts API |
| AI answers, scans, citations, prompt sets, competitors, reports | Visibility | Monthly summaries in the platform's `visibility_snapshots` for the dashboard and later the analyst |
| Directory listing state | Listings vendor | Drift results imported into the platform |
| Site page content | Site builder | — |

### Rules at every boundary

1. **No shared databases.** No other system reads the platform's Postgres, and the platform never reads Elmo's.
2. **One shared key.** The platform's location `account_id` is the shared key; other systems store it as an external reference. Visibility also has prospects with no platform id.
3. **Client logins only in the platform.** Visibility has agency-staff logins and public report links. Sites have no logins.
4. **Only the platform contacts consumers.** Every SMS, email and call goes through its send gate. Other systems ask the platform to send.
5. **Idempotent writes, durable webhooks.** Every cross-system write carries an idempotency key, and every inbound webhook lands in `inbound_webhooks` first (ADR-07).
6. **Contracts are owned by their producer.** Each contract is versioned (`/v1`) and changes by addition. Consumers use generated clients pinned to a version. Breaking changes run side by side until consumers move.

**RLS everywhere:** visibility tables carry `subject_id` (plus the location id once linked) with RLS enabled. All access, including the jobs, goes through `withSubject()`, and cross-subject views use an audited agency role. This is story E53-S13 (1.5 days).

## Component register

Days saved are focused days against the Nov 4 plan. Added cost is per client per month unless stated.

### Foundation and wedge (Phases 0–1)

| Component | Decision | Vendor / approach | Days saved | Added cost | Build-later trigger |
| --- | --- | --- | --- | --- | --- |
| Auth, teams, billing UI | Keep bought | MakerKit | — | — | — |
| Tenancy and RLS | Build | ADR-25 (adds E02-S8, E02-S9) | −3 (added) | — | — |
| Job engine | Keep bought | Hatchet Cloud (ADR-05) | — | Free tier first | Self-host on cost or a missing primitive |
| Telephony and SMS | Keep bought | Twilio ISV, subaccount per location | — | — | Telnyx for voice minutes inside E55 |
| Consent ledger and send gate | Build | Rule that doesn't bend | — | — | — |
| Missed-call text-back | Build | Small, and the core wedge promise | — | — | — |
| Review requests | Build | Small; review SaaS tools are competitors and some gate reviews | — | — | — |
| AEO data collection | Buy | Elmo self-hosted (Perplexity, Claude, Copilot, model APIs) plus Local Falcon geo-grid scans (ChatGPT, AI Overviews, AI Mode, Gemini, Grok) | 4 (extraction) + 1.5 (grid) | ~$3–10 | Visibility replaces Elmo internals with its own engine once over ~10 AEO clients, or when upstream drift makes syncing costly |
| AEO local layer | Build, in `visibility` | Prompt templates, business matching, competitor discovery, gap reports, report pages | — | — | — |
| Visibility boundary | Build | API, webhooks, summary sync, RLS | −3 (added) | — | — |
| Listings audit (wedge) | Buy | BrightLocal-class audit data, checked by hand at first | — | Account fee shared across clients | — |
| Usage metering | Build thin | `usage_events` only in the wedge | 1 | — | — |
| A2P registration | Do by hand | Twilio console plus our opt-in page generator | 7.5 (wizard) | ~1 hour of my time per client (estimate) | More than ~2 new clients a month |
| Observability | Keep bought | Sentry, PostHog, Langfuse Cloud | — | — | — |
| Status page, legal templates | Buy | Hosted status page; counsel-reviewed templates | — | Small | — |

### Core (Phase 2)

| Component | Decision | Vendor / approach | Days saved | Added cost | Build-later trigger |
| --- | --- | --- | --- | --- | --- |
| Voice real-time layer | Buy | Retell (Vapi as fallback) over Twilio Elastic SIP from our subaccounts (ADR-26) | 11 (E11 + E05 handoff) | ~$25–30 at 480 AI min | ~20k AI min/month (~40 Growth clients), or the platform blocks a need → E55 |
| Voice evals | Buy + build | Retell batch simulation tests generated from our YAML; our transcript check for invented prices; nightly real calls | (in E11) | — | With E55 |
| Tool gateway, facts, agent profiles | Build | ADR-11; agent templates as code | — | — | — |
| Text agents (SMS follow-up, later web concierge) | Build | Vercel AI SDK with the same tools; Retell's SMS would bypass the send gate | — | — | — |
| KB ingestion | Buy | Firecrawl API for crawling | 2.5 | ~$1–2 | Crawl spend > a small self-hosted Crawl4AI worker |
| Connector OAuth | Buy | Nango Cloud for connect, tokens and proxy, pending SP6 (ADR-30) | 2 (+ later connectors) | ~$1–3 | Over ~$200/month, or an outage that blocks syncs |
| Jobber connector | Build | No unified API found that covers Jobber; it's the core of FSM-native | — | — | — |
| CRM adapter layer | Build | Rule that doesn't bend (ADR-23) | — | — | — |
| Review engine | Build | Core to the wedge and to the no-gating rule | — | — | — |
| Booking slot engine | Defer | Jobber request plus owner confirms; the agent can offer slots from the availability read | 7 | — | Clients without an FSM need self-serve booking, or confirm lag measurably loses jobs |
| Billing | Simplify | Monthly rating job → Stripe invoice items (ADR-29) | 4 | ~$3 (0.7% Stripe Billing) | Disputes, prepaid wallets, or more than ~30 billed locations → ledger |
| Inbox | Build | Chatwoot would send SMS outside the send gate | — | — | — |

### Platform depth, growth, nerve center, marketing (Phases 3–6)

| Component | Decision | Vendor / approach | Days saved | Build-later trigger |
| --- | --- | --- | --- | --- |
| Workflow builder | Code recipes now | Recipes on Hatchet with a settings UI; Activepieces white-label embedding starts at about $36k a year, so it's out | 17 | Clients ask to build their own automations |
| Housecall Pro | Build adapter | Check Unified.to's HCP coverage at Phase 3 | — | — |
| Email campaigns | Buy sending | Hosted broadcast sending instead of running our own SES reputation; segments and templates ours, through the send gate | 4 | Volume makes SES clearly cheaper |
| Native CRM | Build | Rule that doesn't bend | — | — |
| Listing sync and drift | Buy | BrightLocal-class sync (Google, Bing, Facebook, Apple) and citation builder; facts stay ours | 10 | Bing/Apple partner access granted and more than ~50 locations |
| SEO toolkit | Buy | Local Falcon grid, vendor audits, Search Console import into the report | 9 | — |
| GBP management | Build | Direct API, already connected for reviews | — | — |
| Website builder | Buy | Duda-class white label | 21 | ~30 hosted sites, or a need for server logs and AI-crawler logging the builder can't give |
| Transcript question mining | Build | Differentiator; pushes prompts to visibility | — | — |
| Outbound AI | Build on voice platform | Dials only after the send gate checks written consent, windows, DNC | 6 | With E55 |
| Analyst, metrics, briefs, forecasting | Build | Differentiator | — | — |
| Finance connectors | Decide at Phase 5 | Unified accounting API or Nango vs. direct | — | — |
| DNI call tracking | Buy first | CallRail-class, webhooks into `touchpoints` | 8 | Vendor cost per client exceeds our own number pools, or deeper session joins are needed |
| Spend ingest, conversion uploads, attribution, holdouts | Build | Direct APIs; this is the marketing wing's core | — | — |
| SOC 2 | Buy automation | Vanta/Drata-class | 5 | — |

### Considered and rejected

- **Chatwoot as the inbox:** it sends through its own Twilio channel, outside the send gate.
- **Retell's SMS, knowledge base and its own phone numbers:** they bypass the send gate, let prices come from somewhere other than `kb_facts`, and lock the number away from SMS/A2P. Retell-bought numbers can't be moved into our Twilio account.
- **Review platforms (Podium, Birdeye, NiceJob):** competitors for the same clients, and gating risk.
- **Activepieces Embed:** starts at about $36k a year.
- **Stripe Metronome:** too much for bundles plus overage.
- **A unified FSM API for Jobber:** nothing found that covers Jobber with the depth we need.
- **Extracting Elmo into the platform (old ADR-24 plan):** replaced by the visibility service boundary.

## Cost to serve (typical Growth client)

| Line | Nov 4 plan | Now |
| --- | --- | --- |
| AI voice stack (480 min) | $24–$43 (self-built) | $53–$67 (platform, ~$0.11–$0.14/min) |
| Hosting share | $8–$20 | $6–$15 (no always-on voice machines; visibility shares a small Fly footprint) |
| SEO/AEO data | $5–$20 | $5–$20 (Local Falcon fits inside) |
| RAG + crawl | <$2 | <$4 (Firecrawl) |
| Connector OAuth | — | $1–$3 |
| Stripe Billing | — | ~$3 |
| Everything else | unchanged | unchanged |
| **Total** | **~$100–$190** | **~$135–$210** |

Overage pricing for AI minutes moves from about $0.12–$0.15 to about $0.15–$0.18 per minute, so cost plus 20% still holds.

## Sources

- [Retell AI pricing guide (Layer3 Labs, Jul 2026)](https://www.layer3labs.io/guides/retell-ai-pricing)
- [Retell AI pricing (11x, Sept 2026)](https://www.11x.ai/guides/retell-ai-pricing)
- [Retell batch testing docs](https://docs.retellai.com/test/batch-test-simulation.md)
- [Retell custom telephony docs](https://docs.retellai.com/deploy/custom-telephony.md)
- [Retell community: numbers can't move to Twilio](https://community.retellai.com/t/migrate-retell-phone-number-to-twilio/345)
- [Vapi pricing guide (Layer3 Labs)](https://www.layer3labs.io/guides/vapi-pricing)
- [Pipecat Cloud pricing (Daily)](https://www.daily.co/pricing/pipecat-cloud)
- [Deepgram acquires Daily (Unite.AI)](https://www.unite.ai/?p=497838)
- [Local Falcon: AI visibility scans](https://www.localfalcon.com/knowledge-base/kb95-how-to-run-ai-visibility-scans)
- [Local Falcon pricing](https://localfalcon.com/pricing)
- [Local Falcon pricing guide](https://www.localfalcon.com/knowledge-base/kb81-how-much-does-local-falcon-cost-a-complete-guide-to-local-falcons-pricing)
- [Stripe unbundles usage billing into Metronome (UsagePricing)](https://usagepricing.com/blueprint/activity/stripe-billing-2026-07-22-packaging)
- [Stripe Billing 0.7% (Orb)](https://www.withorb.com/blog/stripe-billing-pricing)
- [Activepieces white-label pricing](https://www.activepieces.com/blog/activepieces-white-label-pricing-cost-by-plan-2026)
- [Nango overview (Ry Walker)](https://rywalker.com/research/nango)
- [Unified.to Housecall Pro](https://unified.to/integrations/housecallpro)
- [Firecrawl pricing (Flexprice)](https://flexprice.io/pricing-index/firecrawl)
- [Duda pricing (duda.co)](https://www.duda.co/plan/d1)
- [BrightLocal overview (Stork)](https://www.stork.ai/en/brightlocal)
