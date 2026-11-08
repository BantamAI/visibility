BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(14);

-- pgTAP records results in session temp tables owned by the test's login role.
DO $$
BEGIN
	EXECUTE format('GRANT USAGE ON SCHEMA %s TO visibility_app, visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
	EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %s TO visibility_app, visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
	EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %s TO visibility_app, visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
END $$;

INSERT INTO organization (id, name, slug, created_at) VALUES ('org-app-role', 'Test Agency', 'test-agency-app-role', now());
INSERT INTO brands (id, name, website, organization_id) VALUES ('subject-app-role', 'Plumber', 'https://p.example', 'org-app-role');

SELECT ok(
	(SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolinherit FROM pg_roles WHERE rolname = 'visibility_app'),
	'the app role is no superuser, bypasses no RLS and inherits nothing'
);
SELECT ok(
	NOT pg_has_role('visibility_app', 'visibility_subject', 'USAGE')
		AND NOT pg_has_role('visibility_app', 'visibility_agency', 'USAGE'),
	'the app role holds no tenancy role''s privileges until it switches to one'
);
SELECT ok(
	NOT EXISTS (
		SELECT 1 FROM pg_class c
		WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
			AND pg_get_userbyid(c.relowner) = 'visibility_app'
	),
	'the app role owns no table'
);

SET LOCAL ROLE visibility_app;

SELECT throws_ok('SELECT * FROM brands', '42501', NULL, 'unscoped: subject rows are out of reach');
SELECT throws_ok(
	$$INSERT INTO prompts (brand_id, value) VALUES ('subject-app-role', 'planted')$$,
	'42501',
	NULL,
	'unscoped: subject rows can''t be written'
);
SELECT throws_ok('SELECT * FROM pipeline_state', '42501', NULL, 'unscoped: agency-only tables are out of reach');
SELECT throws_ok('SELECT * FROM agency_access_log', '42501', NULL, 'unscoped: the access log is out of reach');
SELECT lives_ok('SELECT * FROM session', 'unscoped: better-auth can find who is asking');
SELECT lives_ok('SELECT * FROM secrets', 'unscoped: stored provider credentials load');
SELECT throws_ok($$DELETE FROM secrets$$, '42501', NULL, 'unscoped: stored provider credentials can''t be changed');

SET LOCAL ROLE visibility_subject;
SET LOCAL app.subject_id = 'subject-app-role';

SELECT lives_ok(
	$$INSERT INTO cited_pages (url, domain, page_type, static_category, classifier_version, first_seen_at, last_seen_at)
		VALUES ('https://shared.example/page', 'shared.example', 'article', 'other', 1, now(), now())$$,
	'a subject extends the shared page cache'
);
SELECT is((SELECT count(*)::int FROM brands), 1, 'the app role switches to a subject');

RESET ROLE;

SELECT ok(has_schema_privilege('visibility_agency', 'pgboss', 'USAGE'), 'the agency reaches pg-boss''s queue');

SELECT is(
	(SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = 'pgboss'),
	'visibility_app',
	'pg-boss''s schema belongs to the app role'
);

SELECT * FROM finish(true);

ROLLBACK;
