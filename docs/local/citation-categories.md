# Local citation categories

Local answers lean on business listings and local news, which Elmo's categories scatter across reviews, social and editorial. Two categories pull them out: **Listings** and **Local News**. They show up in the citation views' source mix, charts and category filters alongside Elmo's, and anything that groups citations by category, the gap report included, groups by them too.

## How they're applied

Elmo classifies each cited page once, into `cited_pages.static_category`, and applies brand and competitor domains when it reads. `setCitationCategoryOverride` in `packages/lib/src/citations/domain-lists.ts` lets our code claim a page ahead of Elmo's curated lists but after brand and competitor, so a brand's own site still reads as Brand. Elmo's domain lists aren't edited. The override lives in `packages/service/src/local/citation-categories/`, and web and worker install it at startup.

## Listings

- **Directories:** Yelp, Angi (and Angie's List), BBB, Nextdoor, HomeAdvisor, Thumbtack, Bing Places, Apple Maps and Google Business Profile hosts (`business.google.com`, `g.page`). Every page counts, including search results such as "plumbers in Houston".
- **Maps links:** Google Maps on any Google domain (`/maps`, `maps.google.*`, `maps.app.goo.gl`, `goo.gl/maps`), Google Local Services (`/localservices`) and Bing Maps (`bing.com/maps`).
- **Facebook pages:** `facebook.com/<page>` and its tabs (about, reviews, services), `/pages/…` and `profile.php`. A page's posts, videos and photos, groups, events, Watch, Marketplace and the bare domain stay Social. Facebook can't tell a business page from a person's profile by URL, so a profile cited by name counts too.

The Maps and Facebook rules need the page's URL. Where only a domain is known (domains Elmo's opportunities report summarizes, for example), only the directories count as listings.

## Local News

`local_news_sources` holds news sites by metro. It's seeded with the main papers, TV stations and public radio of 26 large US metros, and edited on the admin Local News page. A site listed under any metro counts as local news for every subject, wherever it's cited, and its subdomains count too. Metros only group the list.

Adding or removing a site reclassifies the pages already cited on that domain, and every brand's copies of them, straight away. Each process keeps the list in memory: the worker reloads it at startup and before every rollup refresh (each minute), and the web app at startup and after each edit. A page first cited in the minute after an edit can be classified with the old list; removing and re-adding the site fixes it.

The table is agency-only: subject-scoped work can't read it.

## Changing the rules

Changes to the listing rules or Elmo's lists need `CLASSIFIER_VERSION` (`packages/lib/src/rollups/constants.ts`) bumped, so the worker reclassifies every page at its next start.
