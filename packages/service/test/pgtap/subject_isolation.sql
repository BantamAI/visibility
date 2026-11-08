BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(24);

-- pgTAP records results in session temp tables owned by the test's login role.
DO $$
BEGIN
	EXECUTE format('GRANT USAGE ON SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
	EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
	EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
END $$;

INSERT INTO organization (id, name, slug, created_at) VALUES ('org-test', 'Test Agency', 'test-agency', now());
INSERT INTO brands (id, name, website, organization_id) VALUES
	('subject-a', 'Plumber A', 'https://a.example', 'org-test'),
	('subject-b', 'Plumber B', 'https://b.example', 'org-test');
INSERT INTO prompts (id, brand_id, value) VALUES
	('00000000-0000-0000-0000-00000000000a', 'subject-a', 'best plumber near me'),
	('00000000-0000-0000-0000-00000000000b', 'subject-b', 'best plumber near me');
INSERT INTO competitors (brand_id, name) VALUES ('subject-a', 'Rival A'), ('subject-b', 'Rival B');
INSERT INTO prompt_runs (id, prompt_id, brand_id, model, version, web_search_enabled, raw_output) VALUES
	('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'subject-a', 'chatgpt', 'v1', true, '{}'),
	('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'subject-b', 'chatgpt', 'v1', true, '{}');
INSERT INTO run_extractions (run_id, text_content) VALUES
	('10000000-0000-0000-0000-00000000000a', 'answer a'),
	('10000000-0000-0000-0000-00000000000b', 'answer b');
INSERT INTO citations (prompt_run_id, prompt_id, brand_id, model, url, domain, citation_index, created_at) VALUES
	('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'subject-a', 'chatgpt', 'https://x.example/a', 'x.example', 0, now()),
	('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'subject-b', 'chatgpt', 'https://x.example/b', 'x.example', 0, now());
INSERT INTO secrets (name, encrypted_value) VALUES ('test-secret', 'ciphertext');

SELECT is(
	(SELECT subject_id FROM run_extractions WHERE run_id = '10000000-0000-0000-0000-00000000000b'),
	'subject-b',
	'run-keyed rows take their run''s subject'
);

SET LOCAL ROLE visibility_subject;

SELECT is((SELECT count(*)::int FROM brands), 0, 'no subject set: brands are hidden');
SELECT is((SELECT count(*)::int FROM prompt_runs), 0, 'no subject set: runs are hidden');

SET LOCAL app.subject_id = 'subject-a';

SELECT results_eq('SELECT id FROM brands', $$VALUES ('subject-a')$$, 'subject sees only its own brand');
SELECT results_eq('SELECT brand_id FROM prompts', $$VALUES ('subject-a')$$, 'subject sees only its own prompts');
SELECT results_eq('SELECT brand_id FROM competitors', $$VALUES ('subject-a')$$, 'subject sees only its own competitors');
SELECT results_eq('SELECT brand_id FROM prompt_runs', $$VALUES ('subject-a')$$, 'subject sees only its own runs');
SELECT results_eq('SELECT text_content FROM run_extractions', $$VALUES ('answer a')$$, 'subject sees only its own extractions');
SELECT results_eq('SELECT url FROM citations', $$VALUES ('https://x.example/a')$$, 'subject sees only its own citations');

UPDATE prompts SET value = 'hijacked' WHERE brand_id = 'subject-b';
DELETE FROM competitors WHERE brand_id = 'subject-b';

SELECT throws_ok(
	$$INSERT INTO prompts (brand_id, value) VALUES ('subject-b', 'planted')$$,
	'42501',
	NULL,
	'subject can''t insert rows for another subject'
);
SELECT throws_ok(
	$$UPDATE prompts SET brand_id = 'subject-b' WHERE brand_id = 'subject-a'$$,
	'42501',
	NULL,
	'subject can''t move its rows to another subject'
);
SELECT throws_ok(
	$$INSERT INTO run_mentions (run_id, brand_mentioned) VALUES ('10000000-0000-0000-0000-00000000000b', true)$$,
	'42501',
	NULL,
	'subject can''t attach rows to another subject''s run'
);
SELECT throws_ok(
	$$INSERT INTO prompts (brand_id, value, subject_id) VALUES ('subject-a', 'spoofed', 'subject-b')$$,
	'428C9',
	NULL,
	'subject_id can''t be written directly'
);
SELECT lives_ok(
	$$INSERT INTO run_mentions (run_id, brand_mentioned) VALUES ('10000000-0000-0000-0000-00000000000a', true)$$,
	'subject can write rows for its own run'
);
SELECT throws_ok('SELECT * FROM secrets', '42501', NULL, 'subject can''t read agency-only secrets');
SELECT throws_ok('SELECT * FROM "user"', '42501', NULL, 'subject can''t read agency logins');

SET LOCAL app.subject_id = '';
SELECT is((SELECT count(*)::int FROM brands), 0, 'cleared subject: brands are hidden');

RESET ROLE;

SELECT is(
	(SELECT value FROM prompts WHERE brand_id = 'subject-b'),
	'best plumber near me',
	'cross-subject update changed nothing'
);
SELECT is(
	(SELECT count(*)::int FROM competitors WHERE brand_id = 'subject-b'),
	1,
	'cross-subject delete removed nothing'
);

SET LOCAL ROLE visibility_agency;

SELECT is((SELECT count(*)::int FROM brands), 2, 'agency sees every subject');
SELECT is((SELECT count(*)::int FROM secrets), 1, 'agency reads agency-only tables');
SELECT lives_ok(
	$$INSERT INTO agency_access_log (actor, reason) VALUES ('staff@test', 'pgTAP')$$,
	'agency records its access'
);
SELECT throws_ok('SELECT * FROM agency_access_log', '42501', NULL, 'agency can''t read the access log');
SELECT throws_ok('DELETE FROM agency_access_log', '42501', NULL, 'agency can''t erase the access log');

RESET ROLE;

SELECT * FROM finish(true);

ROLLBACK;
