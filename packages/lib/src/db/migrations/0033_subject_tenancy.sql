-- Subject tenancy (E53-S13). Every table is either scoped to a subject (a tracked
-- brand: a prospect or a client) or registered as agency-only. Two NOLOGIN roles
-- carry the policies, and the app reaches them with SET LOCAL ROLE:
--   visibility_subject: only rows whose subject_id matches app.subject_id
--   visibility_agency:  every subject, entered only after writing agency_access_log
-- The table owner bypasses RLS and is for migrations only.

-- Roles are cluster-wide, so another database on the same server may already have them.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'visibility_subject') THEN
		CREATE ROLE visibility_subject NOLOGIN NOBYPASSRLS;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'visibility_agency') THEN
		CREATE ROLE visibility_agency NOLOGIN NOBYPASSRLS;
	END IF;
END $$;
--> statement-breakpoint
GRANT visibility_subject, visibility_agency TO CURRENT_USER;
--> statement-breakpoint
CREATE SCHEMA tenancy;
--> statement-breakpoint
GRANT USAGE ON SCHEMA tenancy TO visibility_subject, visibility_agency;
--> statement-breakpoint
-- Null when unset, and '' once a transaction that set it has ended, so both match nothing.
CREATE FUNCTION tenancy.current_subject() RETURNS text
	LANGUAGE sql STABLE
	AS $$ SELECT nullif(current_setting('app.subject_id', true), '') $$;
--> statement-breakpoint
CREATE TABLE tenancy.agency_only_tables (
	table_name regclass PRIMARY KEY,
	reason text NOT NULL
);
--> statement-breakpoint
CREATE FUNCTION tenancy.scope_to_subject(tbl regclass) RETURNS void
	LANGUAGE plpgsql
	AS $$
DECLARE
	rel text := (SELECT relname FROM pg_class WHERE oid = tbl);
BEGIN
	EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
	EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (subject_id)', rel || '_subject_id_idx', tbl);
	EXECUTE format('DROP POLICY IF EXISTS subject_isolation ON %s', tbl);
	EXECUTE format(
		'CREATE POLICY subject_isolation ON %s FOR ALL TO visibility_subject '
		'USING (subject_id = tenancy.current_subject()) WITH CHECK (subject_id = tenancy.current_subject())',
		tbl
	);
	EXECUTE format('DROP POLICY IF EXISTS agency_access ON %s', tbl);
	EXECUTE format('CREATE POLICY agency_access ON %s FOR ALL TO visibility_agency USING (true) WITH CHECK (true)', tbl);
	EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO visibility_subject, visibility_agency', tbl);
	DELETE FROM tenancy.agency_only_tables WHERE table_name = tbl;
END $$;
--> statement-breakpoint
CREATE FUNCTION tenancy.restrict_to_agency(tbl regclass, reason text) RETURNS void
	LANGUAGE plpgsql
	AS $$
BEGIN
	EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
	EXECUTE format('DROP POLICY IF EXISTS agency_access ON %s', tbl);
	EXECUTE format('CREATE POLICY agency_access ON %s FOR ALL TO visibility_agency USING (true) WITH CHECK (true)', tbl);
	EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO visibility_agency', tbl);
	INSERT INTO tenancy.agency_only_tables (table_name, reason) VALUES (tbl, reason)
		ON CONFLICT (table_name) DO UPDATE SET reason = excluded.reason;
END $$;
--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "subject_id" text GENERATED ALWAYS AS ("id") STORED NOT NULL;
--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "subject_id" text GENERATED ALWAYS AS ("brand_id") STORED NOT NULL;
--> statement-breakpoint
ALTER TABLE "competitors" ADD COLUMN "subject_id" text GENERATED ALWAYS AS ("brand_id") STORED NOT NULL;
--> statement-breakpoint
ALTER TABLE "prompt_runs" ADD COLUMN "subject_id" text GENERATED ALWAYS AS ("brand_id") STORED NOT NULL;
--> statement-breakpoint
ALTER TABLE "citations" ADD COLUMN "subject_id" text GENERATED ALWAYS AS ("brand_id") STORED NOT NULL;
--> statement-breakpoint
ALTER TABLE "brand_opportunities" ADD COLUMN "subject_id" text GENERATED ALWAYS AS ("brand_id") STORED NOT NULL;
--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "subject_id" text GENERATED ALWAYS AS ("brand_id") STORED NOT NULL;
--> statement-breakpoint
ALTER TABLE "rollup_prompt_runs" ADD COLUMN "subject_id" text GENERATED ALWAYS AS ("brand_id") STORED NOT NULL;
--> statement-breakpoint
ALTER TABLE "rollup_competitor_mentions" ADD COLUMN "subject_id" text GENERATED ALWAYS AS ("brand_id") STORED NOT NULL;
--> statement-breakpoint
ALTER TABLE "rollup_citation_urls" ADD COLUMN "subject_id" text GENERATED ALWAYS AS ("brand_id") STORED NOT NULL;
--> statement-breakpoint
ALTER TABLE "rollup_citation_pages" ADD COLUMN "subject_id" text GENERATED ALWAYS AS ("brand_id") STORED NOT NULL;
--> statement-breakpoint
ALTER TABLE "rollup_web_queries" ADD COLUMN "subject_id" text GENERATED ALWAYS AS ("brand_id") STORED NOT NULL;
--> statement-breakpoint
ALTER TABLE "rollup_sentiment_quotes" ADD COLUMN "subject_id" text GENERATED ALWAYS AS ("brand_id") STORED NOT NULL;
--> statement-breakpoint
ALTER TABLE "rollup_dirty" ADD COLUMN "subject_id" text GENERATED ALWAYS AS ("brand_id") STORED NOT NULL;
--> statement-breakpoint
-- A generated column can't read another table, so rows keyed only by run take the
-- run's subject. Under visibility_subject the lookup is itself filtered by RLS, so a
-- run from another subject resolves to null, which the policy rejects.
CREATE FUNCTION tenancy.subject_from_run() RETURNS trigger
	LANGUAGE plpgsql
	AS $$
BEGIN
	NEW.subject_id := (SELECT brand_id FROM public.prompt_runs WHERE id = NEW.run_id);
	RETURN NEW;
END $$;
--> statement-breakpoint
ALTER TABLE "run_extractions" ADD COLUMN "subject_id" text;
--> statement-breakpoint
UPDATE "run_extractions" e SET "subject_id" = r."brand_id" FROM "prompt_runs" r WHERE r."id" = e."run_id";
--> statement-breakpoint
ALTER TABLE "run_extractions" ALTER COLUMN "subject_id" SET NOT NULL;
--> statement-breakpoint
CREATE TRIGGER run_extractions_subject BEFORE INSERT OR UPDATE ON "run_extractions"
	FOR EACH ROW EXECUTE FUNCTION tenancy.subject_from_run();
--> statement-breakpoint
ALTER TABLE "run_mentions" ADD COLUMN "subject_id" text;
--> statement-breakpoint
UPDATE "run_mentions" m SET "subject_id" = r."brand_id" FROM "prompt_runs" r WHERE r."id" = m."run_id";
--> statement-breakpoint
ALTER TABLE "run_mentions" ALTER COLUMN "subject_id" SET NOT NULL;
--> statement-breakpoint
CREATE TRIGGER run_mentions_subject BEFORE INSERT OR UPDATE ON "run_mentions"
	FOR EACH ROW EXECUTE FUNCTION tenancy.subject_from_run();
--> statement-breakpoint
SELECT tenancy.scope_to_subject(t::regclass) FROM unnest(ARRAY[
	'brands', 'prompts', 'competitors', 'prompt_runs', 'run_extractions', 'run_mentions',
	'citations', 'brand_opportunities', 'usage_events',
	'rollup_prompt_runs', 'rollup_competitor_mentions', 'rollup_citation_urls',
	'rollup_citation_pages', 'rollup_web_queries', 'rollup_sentiment_quotes', 'rollup_dirty'
]) AS t;
--> statement-breakpoint
CREATE TABLE "agency_access_log" (
	"id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	"actor" text NOT NULL,
	"reason" text NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agency_access_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Append-only for the agency role: it records its own access and can't read or erase it.
CREATE POLICY agency_append ON "agency_access_log" FOR INSERT TO visibility_agency WITH CHECK (true);
--> statement-breakpoint
GRANT INSERT ON "agency_access_log" TO visibility_agency;
--> statement-breakpoint
INSERT INTO tenancy.agency_only_tables (table_name, reason)
	VALUES ('agency_access_log'::regclass, 'Audit trail of cross-subject access; append-only for the agency role.');
--> statement-breakpoint
SELECT tenancy.restrict_to_agency(t::regclass, 'Agency staff login, session and API credential data (better-auth).')
	FROM unnest(ARRAY[
		'"user"', 'session', 'account', 'verification', 'organization', 'member', 'invitation',
		'apikey', 'jwks', 'oauth_client', 'oauth_resource', 'oauth_client_resource',
		'oauth_refresh_token', 'oauth_access_token', 'oauth_consent', 'oauth_client_assertion',
		'sso_provider', 'subscription', 'rate_limit'
	]) AS t;
--> statement-breakpoint
SELECT tenancy.restrict_to_agency('organization_settings', 'Agency-wide settings.');
--> statement-breakpoint
SELECT tenancy.restrict_to_agency('secrets', 'Agency-wide encrypted provider credentials.');
--> statement-breakpoint
SELECT tenancy.restrict_to_agency('cited_pages', 'Shared classification cache of public web pages; holds no subject data.');
--> statement-breakpoint
SELECT tenancy.restrict_to_agency('reports', 'One-off reports on a name and website, not yet tied to a subject.');
--> statement-breakpoint
SELECT tenancy.restrict_to_agency('pipeline_state', 'Worker pipeline bookkeeping.');
--> statement-breakpoint
SELECT tenancy.restrict_to_agency('background_migrations', 'Worker data-migration bookkeeping.');
