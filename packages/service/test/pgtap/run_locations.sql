BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(11);

-- pgTAP records results in session temp tables owned by the test's login role.
DO $$
BEGIN
	EXECUTE format('GRANT USAGE ON SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
	EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
	EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
END $$;

INSERT INTO organization (id, name, slug, created_at) VALUES ('org-runloc', 'Test Agency', 'test-agency-runloc', now());
INSERT INTO brands (id, name, website, organization_id) VALUES
	('runloc-a', 'Plumber A', 'https://a.example', 'org-runloc'),
	('runloc-b', 'Plumber B', 'https://b.example', 'org-runloc');
INSERT INTO prompts (id, brand_id, value) VALUES
	('40000000-0000-0000-0000-00000000000a', 'runloc-a', 'plumber near me'),
	('40000000-0000-0000-0000-00000000000b', 'runloc-b', 'plumber near me');
INSERT INTO prompt_runs (id, prompt_id, brand_id, model, version, web_search_enabled, raw_output) VALUES
	('41000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-00000000000a', 'runloc-a', 'google-ai-mode', 'v1', true, '{}'),
	('41000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-00000000000b', 'runloc-b', 'google-ai-mode', 'v1', true, '{}'),
	('41000000-0000-0000-0000-00000000000c', '40000000-0000-0000-0000-00000000000a', 'runloc-a', 'google-ai-mode', 'v1', true, '{}');
INSERT INTO run_locations (run_id, subject_id, point_id, requested_location, location_method, fidelity_tier) VALUES
	('41000000-0000-0000-0000-00000000000a', 'runloc-b', '42000000-0000-0000-0000-00000000000a', '{"city": "Raleigh"}', 'geo_coordinate', 'T1'),
	('41000000-0000-0000-0000-00000000000b', 'runloc-b', '42000000-0000-0000-0000-00000000000b', '{"city": "Durham"}', 'egress_city', 'T2');

SELECT is(
	(SELECT subject_id FROM run_locations WHERE run_id = '41000000-0000-0000-0000-00000000000a'),
	'runloc-a',
	'a run location takes its run''s subject, whatever the writer claimed'
);
SELECT throws_ok(
	$$INSERT INTO run_locations (run_id, subject_id, point_id, requested_location, location_method, fidelity_tier)
		VALUES ('41000000-0000-0000-0000-00000000000c', 'runloc-a', '42000000-0000-0000-0000-00000000000a', '{}', 'egress_city', 'T1')$$,
	'23514',
	NULL,
	'the method has to be the one its tier implies'
);
SELECT throws_ok(
	$$INSERT INTO run_locations (run_id, subject_id, point_id, requested_location, location_method, fidelity_tier, cost_usd)
		VALUES ('41000000-0000-0000-0000-00000000000c', 'runloc-a', '42000000-0000-0000-0000-00000000000a', '{}', 'geo_coordinate', 'T1', 0.01)$$,
	'23514',
	NULL,
	'a cost says where it came from'
);

SET LOCAL ROLE visibility_subject;

SELECT is((SELECT count(*)::int FROM run_locations), 0, 'no subject set: run locations are hidden');

SET LOCAL app.subject_id = 'runloc-a';

SELECT results_eq(
	$$SELECT requested_location->>'city' FROM run_locations$$,
	$$VALUES ('Raleigh')$$,
	'subject sees only its own run locations'
);

UPDATE run_locations SET vendor_run_id = 'hijacked' WHERE run_id = '41000000-0000-0000-0000-00000000000b';
DELETE FROM run_locations WHERE run_id = '41000000-0000-0000-0000-00000000000b';

SELECT throws_ok(
	$$UPDATE run_locations SET run_id = '41000000-0000-0000-0000-00000000000b' WHERE run_id = '41000000-0000-0000-0000-00000000000a'$$,
	'42501',
	NULL,
	'subject can''t move a run location onto another subject''s run'
);
SELECT lives_ok(
	$$INSERT INTO run_locations (run_id, subject_id, point_id, requested_location, location_method, fidelity_tier, cost_usd, cost_source)
		VALUES ('41000000-0000-0000-0000-00000000000c', 'runloc-a', '42000000-0000-0000-0000-00000000000a', '{}', 'prompt_only', 'T5', 0.004, 'estimate')$$,
	'subject can record where its own run came from'
);

RESET ROLE;

SELECT is(
	(SELECT count(*)::int FROM run_locations WHERE run_id = '41000000-0000-0000-0000-00000000000b' AND vendor_run_id IS NULL),
	1,
	'cross-subject update and delete changed nothing'
);

SET LOCAL ROLE visibility_subject;
SET LOCAL app.subject_id = 'runloc-a';

SELECT throws_ok(
	$$INSERT INTO run_locations (run_id, subject_id, point_id, requested_location, location_method, fidelity_tier)
		VALUES ('41000000-0000-0000-0000-00000000000b', 'runloc-a', '42000000-0000-0000-0000-00000000000b', '{}', 'geo_coordinate', 'T1')$$,
	'42501',
	NULL,
	'subject can''t attach a location to another subject''s run'
);

RESET ROLE;
SET LOCAL ROLE visibility_agency;

SELECT is((SELECT count(*)::int FROM run_locations), 3, 'agency sees every subject''s run locations');

RESET ROLE;

DELETE FROM prompt_runs WHERE id = '41000000-0000-0000-0000-00000000000b';
SELECT is(
	(SELECT count(*)::int FROM run_locations WHERE run_id = '41000000-0000-0000-0000-00000000000b'),
	0,
	'deleting a run deletes its location'
);

SELECT * FROM finish(true);

ROLLBACK;
