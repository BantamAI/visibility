-- The app's own login role (E53-S37). The web app and worker connect as
-- visibility_app; the table owner runs migrations and nothing else. The role is
-- NOINHERIT, so its membership in the tenancy roles grants nothing until
-- withSubject() or withAgency() switches to one with SET ROLE, and a query outside
-- both reaches no subject rows. It is created without a password: the deployment
-- sets one with packages/service/scripts/enable-app-login.mjs.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'visibility_app') THEN
		CREATE ROLE visibility_app NOLOGIN NOINHERIT NOBYPASSRLS;
	ELSIF (SELECT rolinherit FROM pg_roles WHERE rolname = 'visibility_app') THEN
		ALTER ROLE visibility_app NOINHERIT;
	END IF;
	IF (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = 'visibility_app') THEN
		RAISE EXCEPTION 'visibility_app must not be a superuser or bypass RLS';
	END IF;
END $$;
--> statement-breakpoint
GRANT visibility_subject, visibility_agency TO visibility_app;
--> statement-breakpoint
-- On PostgreSQL 16+ a grant made while the role still inherited keeps inheriting.
DO $$
BEGIN
	IF pg_has_role('visibility_app', 'visibility_subject', 'USAGE')
		OR pg_has_role('visibility_app', 'visibility_agency', 'USAGE') THEN
		RAISE EXCEPTION 'visibility_app inherits a tenancy role; revoke the grants and run this migration again';
	END IF;
END $$;
--> statement-breakpoint
-- Lets the owner hand pg-boss's schema over below.
GRANT visibility_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO visibility_app;
--> statement-breakpoint
-- Tables the login role reaches before a request knows who is asking: better-auth
-- reads sessions and API keys to find that out, and the credential overlay loads
-- provider keys at boot. None of them hold subject data.
CREATE FUNCTION tenancy.grant_to_app(tbl regclass, privileges text) RETURNS void
	LANGUAGE plpgsql
	AS $$
BEGIN
	EXECUTE format('DROP POLICY IF EXISTS app_access ON %s', tbl);
	EXECUTE format('CREATE POLICY app_access ON %s FOR ALL TO visibility_app USING (true) WITH CHECK (true)', tbl);
	EXECUTE format('GRANT %s ON %s TO visibility_app', privileges, tbl);
END $$;
--> statement-breakpoint
SELECT tenancy.grant_to_app(t::regclass, 'SELECT, INSERT, UPDATE, DELETE')
	FROM unnest(ARRAY[
		'"user"', 'session', 'account', 'verification', 'organization', 'member', 'invitation',
		'apikey', 'jwks', 'oauth_client', 'oauth_resource', 'oauth_client_resource',
		'oauth_refresh_token', 'oauth_access_token', 'oauth_consent', 'oauth_client_assertion',
		'sso_provider', 'subscription', 'rate_limit'
	]) AS t;
--> statement-breakpoint
SELECT tenancy.grant_to_app('secrets', 'SELECT');
--> statement-breakpoint
-- Agency-only tables that subject-scoped work also reads and extends.
CREATE FUNCTION tenancy.share_with_subjects(tbl regclass, privileges text) RETURNS void
	LANGUAGE plpgsql
	AS $$
BEGIN
	EXECUTE format('DROP POLICY IF EXISTS subject_shared ON %s', tbl);
	EXECUTE format('CREATE POLICY subject_shared ON %s FOR ALL TO visibility_subject USING (true) WITH CHECK (true)', tbl);
	EXECUTE format('GRANT %s ON %s TO visibility_subject', privileges, tbl);
END $$;
--> statement-breakpoint
-- Judging a run upserts the public pages it cites.
SELECT tenancy.share_with_subjects('cited_pages', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
UPDATE tenancy.agency_only_tables
	SET reason = 'Shared classification cache of public web pages; holds no subject data, so subject-scoped jobs read and extend it.'
	WHERE table_name = 'cited_pages'::regclass;
--> statement-breakpoint
-- pg-boss runs as the app role and installs and upgrades its own tables, so it has
-- to own its schema. The app constructs pg-boss with createSchema: false.
DO $$
DECLARE
	item record;
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'pgboss') THEN
		CREATE SCHEMA pgboss AUTHORIZATION visibility_app;
		RETURN;
	END IF;
	ALTER SCHEMA pgboss OWNER TO visibility_app;
	FOR item IN
		SELECT c.oid::regclass AS name, c.relkind FROM pg_class c
		WHERE c.relnamespace = 'pgboss'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
	LOOP
		CONTINUE WHEN item.relkind = 'S' AND EXISTS (
			SELECT 1 FROM pg_depend d
			WHERE d.classid = 'pg_class'::regclass AND d.objid = item.name::oid AND d.deptype IN ('a', 'i')
		);
		EXECUTE format(
			'ALTER %s %s OWNER TO visibility_app',
			CASE item.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
			item.name
		);
	END LOOP;
	FOR item IN SELECT p.oid::regprocedure AS name FROM pg_proc p WHERE p.pronamespace = 'pgboss'::regnamespace LOOP
		EXECUTE format('ALTER ROUTINE %s OWNER TO visibility_app', item.name);
	END LOOP;
	FOR item IN
		SELECT t.oid::regtype AS name FROM pg_type t
		WHERE t.typnamespace = 'pgboss'::regnamespace AND t.typtype IN ('e', 'd')
	LOOP
		EXECUTE format('ALTER TYPE %s OWNER TO visibility_app', item.name);
	END LOOP;
END $$;
--> statement-breakpoint
-- The dashboard and the maintenance job read pg-boss's queue and expedite jobs in it.
GRANT USAGE ON SCHEMA pgboss TO visibility_agency;
--> statement-breakpoint
GRANT SELECT, UPDATE ON ALL TABLES IN SCHEMA pgboss TO visibility_agency;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE visibility_app IN SCHEMA pgboss GRANT SELECT, UPDATE ON TABLES TO visibility_agency;
