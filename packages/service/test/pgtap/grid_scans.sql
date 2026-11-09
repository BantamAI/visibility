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

INSERT INTO organization (id, name, slug, created_at) VALUES ('org-scan', 'Test Agency', 'test-agency-scan', now());
INSERT INTO brands (id, name, website, organization_id) VALUES
	('scan-a', 'Plumber A', 'https://a.example', 'org-scan'),
	('scan-b', 'Plumber B', 'https://b.example', 'org-scan');
INSERT INTO prompts (id, brand_id, value) VALUES
	('00000000-0000-0000-0000-00000000aa01', 'scan-a', 'plumber near me'),
	('00000000-0000-0000-0000-00000000bb01', 'scan-b', 'plumber near me');
INSERT INTO grid_scans (id, subject_id, area_id, prompt_id, model, provider, web_search_enabled, fidelity_tier, point_kind, repeats, points_planned) VALUES
	('00000000-0000-0000-0000-0000000000a1', 'scan-a', gen_random_uuid(), '00000000-0000-0000-0000-00000000aa01', 'google-ai-mode', 'dataforseo', true, 'T1', 'grid', 1, 9),
	('00000000-0000-0000-0000-0000000000b1', 'scan-b', gen_random_uuid(), '00000000-0000-0000-0000-00000000bb01', 'google-ai-mode', 'dataforseo', true, 'T1', 'grid', 1, 9);
INSERT INTO grid_scan_runs (subject_id, scan_id, point_id, location, repeat) VALUES
	('scan-a', '00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), '{}', 1),
	('scan-b', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), '{}', 1);

SELECT throws_ok(
	$$INSERT INTO grid_scan_runs (subject_id, scan_id, point_id, location, repeat)
		VALUES ('scan-a', '00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), '{}', 1)$$,
	'23503',
	NULL,
	'a run can''t join another subject''s scan'
);
SELECT throws_ok(
	$$UPDATE grid_scan_runs SET status = 'answered' WHERE subject_id = 'scan-a'$$,
	'23514',
	NULL,
	'an answered run needs its prompt run'
);

SET LOCAL ROLE visibility_subject;

SELECT is((SELECT count(*)::int FROM grid_scans), 0, 'no subject set: scans are hidden');

SET LOCAL app.subject_id = 'scan-a';

SELECT results_eq($$SELECT subject_id FROM grid_scans$$, $$VALUES ('scan-a'::text)$$, 'subject sees only its own scans');
SELECT results_eq($$SELECT subject_id FROM grid_scan_runs$$, $$VALUES ('scan-a'::text)$$, 'subject sees only its own runs');

UPDATE grid_scan_runs SET last_error = 'tampered' WHERE subject_id = 'scan-b';
DELETE FROM grid_scans WHERE subject_id = 'scan-b';

SELECT throws_ok(
	$$INSERT INTO grid_scans (subject_id, area_id, prompt_id, model, provider, web_search_enabled, fidelity_tier, point_kind, repeats, points_planned)
		VALUES ('scan-b', gen_random_uuid(), '00000000-0000-0000-0000-00000000bb01', 'google-ai-mode', 'dataforseo', true, 'T1', 'grid', 1, 9)$$,
	'42501',
	NULL,
	'subject can''t start a scan for another subject'
);
SELECT throws_ok(
	$$UPDATE grid_scan_runs SET subject_id = 'scan-b' WHERE subject_id = 'scan-a'$$,
	'42501',
	NULL,
	'subject can''t move its runs to another subject'
);
SELECT lives_ok(
	$$UPDATE grid_scan_runs SET attempts = attempts + 1 WHERE subject_id = 'scan-a'$$,
	'subject can count an attempt on its own run'
);

RESET ROLE;

SELECT results_eq(
	$$SELECT (SELECT count(*)::int FROM grid_scans WHERE subject_id = 'scan-b'), (SELECT last_error FROM grid_scan_runs WHERE subject_id = 'scan-b')$$,
	$$VALUES (1, NULL::text)$$,
	'cross-subject update and delete changed nothing'
);

SET LOCAL ROLE visibility_agency;

SELECT is((SELECT count(*)::int FROM grid_scan_runs), 2, 'agency sees every subject''s runs');

RESET ROLE;

-- In deleteBrand's order: upstream's prompts don't cascade from brands.
DELETE FROM prompts WHERE brand_id = 'scan-a';
DELETE FROM brands WHERE id = 'scan-a';
SELECT is(
	(SELECT count(*)::int FROM grid_scan_runs WHERE subject_id = 'scan-a'),
	0,
	'deleting a subject deletes its scans and their runs'
);

SELECT * FROM finish(true);

ROLLBACK;
