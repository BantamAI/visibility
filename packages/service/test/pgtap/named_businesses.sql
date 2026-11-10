BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(14);

-- pgTAP records results in session temp tables owned by the test's login role.
DO $$
BEGIN
	EXECUTE format('GRANT USAGE ON SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
	EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
	EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
END $$;

INSERT INTO organization (id, name, slug, created_at) VALUES ('org-named', 'Test Agency', 'test-agency-named', now());
INSERT INTO brands (id, name, website, organization_id) VALUES
	('named-a', 'Plumber A', 'https://a.example', 'org-named'),
	('named-b', 'Plumber B', 'https://b.example', 'org-named');
INSERT INTO prompts (id, brand_id, value) VALUES
	('54000000-0000-0000-0000-00000000000a', 'named-a', 'plumber near me'),
	('54000000-0000-0000-0000-00000000000b', 'named-b', 'plumber near me');
INSERT INTO prompt_runs (id, prompt_id, brand_id, model, version, web_search_enabled, raw_output) VALUES
	('55000000-0000-0000-0000-00000000000a', '54000000-0000-0000-0000-00000000000a', 'named-a', 'claude', 'v1', true, '{}'),
	('55000000-0000-0000-0000-00000000000b', '54000000-0000-0000-0000-00000000000b', 'named-b', 'claude', 'v1', true, '{}');
INSERT INTO answer_named_businesses (run_id, subject_id, position, name, name_key) VALUES
	('55000000-0000-0000-0000-00000000000a', 'named-b', 1, 'Oak City Plumbing', 'oak city plumbing'),
	('55000000-0000-0000-0000-00000000000b', 'named-b', 1, 'Mile High Plumbing', 'mile high plumbing');
INSERT INTO place_resolutions (subject_id, name_key, phone, resolution, place_id, search_query) VALUES
	('named-a', 'oak city plumbing', NULL, 'matched', 'ChIJoakcityoakcity0001', 'Oak City Plumbing'),
	('named-b', 'mile high plumbing', NULL, 'none', NULL, 'Mile High Plumbing');

SELECT is(
	(SELECT subject_id FROM answer_named_businesses WHERE run_id = '55000000-0000-0000-0000-00000000000a'),
	'named-a',
	'a named business takes its run''s subject, whatever the writer claimed'
);
SELECT throws_ok(
	$$INSERT INTO place_resolutions (subject_id, name_key, resolution, search_query)
		VALUES ('named-a', 'triangle rooter', 'matched', 'Triangle Rooter')$$,
	'23514',
	NULL,
	'a matched name has a Place ID'
);
SELECT throws_ok(
	$$INSERT INTO place_resolutions (subject_id, name_key, resolution, search_query)
		VALUES ('named-a', 'oak city plumbing', 'none', 'Oak City Plumbing')$$,
	'23505',
	NULL,
	'a subject resolves a name and phone once'
);
SELECT lives_ok(
	$$INSERT INTO place_resolutions (subject_id, name_key, phone, resolution, search_query)
		VALUES ('named-a', 'oak city plumbing', '+19195550100', 'none', 'Oak City Plumbing')$$,
	'the same name with a phone is another resolution'
);

SET LOCAL ROLE visibility_subject;

SELECT is((SELECT count(*)::int FROM answer_named_businesses), 0, 'no subject set: named businesses are hidden');
SELECT is((SELECT count(*)::int FROM place_resolutions), 0, 'no subject set: resolutions are hidden');

SET LOCAL app.subject_id = 'named-a';

SELECT results_eq(
	$$SELECT name FROM answer_named_businesses$$,
	$$VALUES ('Oak City Plumbing')$$,
	'subject sees only its own runs'' named businesses'
);
SELECT results_eq(
	$$SELECT resolution::text FROM place_resolutions ORDER BY phone NULLS FIRST$$,
	$$VALUES ('matched'), ('none')$$,
	'subject sees only its own resolutions'
);

UPDATE answer_named_businesses SET name = 'Hijacked' WHERE run_id = '55000000-0000-0000-0000-00000000000b';
UPDATE place_resolutions SET resolution = 'elsewhere' WHERE subject_id = 'named-b';

SELECT throws_ok(
	$$INSERT INTO answer_named_businesses (run_id, subject_id, position, name, name_key)
		VALUES ('55000000-0000-0000-0000-00000000000b', 'named-a', 2, 'Planted', 'planted')$$,
	'42501',
	NULL,
	'subject can''t add named businesses to another subject''s run'
);
SELECT throws_ok(
	$$INSERT INTO place_resolutions (subject_id, name_key, resolution, search_query)
		VALUES ('named-b', 'planted', 'none', 'Planted')$$,
	'42501',
	NULL,
	'subject can''t add resolutions for another subject'
);

RESET ROLE;

SELECT is(
	(SELECT name FROM answer_named_businesses WHERE run_id = '55000000-0000-0000-0000-00000000000b'),
	'Mile High Plumbing',
	'cross-subject update of a named business changed nothing'
);
SELECT is(
	(SELECT resolution::text FROM place_resolutions WHERE subject_id = 'named-b'),
	'none',
	'cross-subject update of a resolution changed nothing'
);

SET LOCAL ROLE visibility_agency;

SELECT is((SELECT count(*)::int FROM answer_named_businesses), 2, 'agency sees every subject''s named businesses');

RESET ROLE;

DELETE FROM prompt_runs WHERE id = '55000000-0000-0000-0000-00000000000b';
SELECT is(
	(SELECT count(*)::int FROM answer_named_businesses WHERE run_id = '55000000-0000-0000-0000-00000000000b'),
	0,
	'deleting a run deletes its named businesses'
);

SELECT * FROM finish(true);

ROLLBACK;
