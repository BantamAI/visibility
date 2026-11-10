BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(10);

-- pgTAP records results in session temp tables owned by the test's login role.
DO $$
BEGIN
	EXECUTE format('GRANT USAGE ON SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
	EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
	EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
END $$;

INSERT INTO organization (id, name, slug, created_at) VALUES ('org-local-mentions', 'Test Agency', 'test-agency-local-mentions', now());
INSERT INTO brands (id, name, website, organization_id) VALUES
	('local-mentions-a', 'Plumber A', 'https://a.example', 'org-local-mentions'),
	('local-mentions-b', 'Plumber B', 'https://b.example', 'org-local-mentions');
INSERT INTO prompts (id, brand_id, value) VALUES
	('52000000-0000-0000-0000-00000000000a', 'local-mentions-a', 'plumber near me'),
	('52000000-0000-0000-0000-00000000000b', 'local-mentions-b', 'plumber near me');
INSERT INTO prompt_runs (id, prompt_id, brand_id, model, version, web_search_enabled, raw_output) VALUES
	('53000000-0000-0000-0000-00000000000a', '52000000-0000-0000-0000-00000000000a', 'local-mentions-a', 'google-ai-mode', 'v1', true, '{}'),
	('53000000-0000-0000-0000-00000000000b', '52000000-0000-0000-0000-00000000000b', 'local-mentions-b', 'google-ai-mode', 'v1', true, '{}');
INSERT INTO local_mentions (run_id, subject_id, competitor_name, counted, method, confidence, card_placement, card_position) VALUES
	('53000000-0000-0000-0000-00000000000a', 'local-mentions-b', NULL, true, 'place_id', 1, 'answer', 1),
	('53000000-0000-0000-0000-00000000000b', 'local-mentions-b', NULL, true, 'text+jev', 0.9, NULL, NULL);

SELECT is(
	(SELECT subject_id FROM local_mentions WHERE run_id = '53000000-0000-0000-0000-00000000000a'),
	'local-mentions-a',
	'a mention takes its run''s subject, whatever the writer claimed'
);
SELECT throws_ok(
	$$INSERT INTO local_mentions (run_id, subject_id, competitor_name, counted, method, confidence, card_placement)
		VALUES ('53000000-0000-0000-0000-00000000000a', 'local-mentions-a', 'Rival', true, 'cid', 1, 'answer')$$,
	'23514',
	NULL,
	'a matched card has both a placement and a position'
);

SET LOCAL ROLE visibility_subject;

SELECT is((SELECT count(*)::int FROM local_mentions), 0, 'no subject set: mentions are hidden');

SET LOCAL app.subject_id = 'local-mentions-a';

SELECT results_eq(
	$$SELECT method::text FROM local_mentions$$,
	$$VALUES ('place_id')$$,
	'subject sees only its own runs'' mentions'
);

UPDATE local_mentions SET counted = false WHERE run_id = '53000000-0000-0000-0000-00000000000b';
DELETE FROM local_mentions WHERE run_id = '53000000-0000-0000-0000-00000000000b';

SELECT throws_ok(
	$$INSERT INTO local_mentions (run_id, subject_id, competitor_name, counted, method, confidence)
		VALUES ('53000000-0000-0000-0000-00000000000b', 'local-mentions-a', 'Planted', true, 'phone', 0.95)$$,
	'42501',
	NULL,
	'subject can''t add mentions to another subject''s run'
);
SELECT lives_ok(
	$$INSERT INTO local_mentions (run_id, subject_id, competitor_name, counted, method, confidence, review)
		VALUES ('53000000-0000-0000-0000-00000000000a', 'local-mentions-a', 'Rival', true, 'text+jev', 0.8, 'unresolved')$$,
	'subject can record its own run''s mentions'
);
SELECT throws_ok(
	$$INSERT INTO local_mentions (run_id, subject_id, competitor_name, counted, method, confidence)
		VALUES ('53000000-0000-0000-0000-00000000000a', 'local-mentions-a', 'RIVAL', true, 'phone', 0.95)$$,
	'23505',
	NULL,
	'a run has one mention row per business'
);

RESET ROLE;

SELECT is(
	(SELECT counted FROM local_mentions WHERE run_id = '53000000-0000-0000-0000-00000000000b'),
	true,
	'cross-subject update and delete changed nothing'
);

SET LOCAL ROLE visibility_agency;

SELECT is((SELECT count(*)::int FROM local_mentions), 3, 'agency sees every subject''s mentions');

RESET ROLE;

DELETE FROM prompt_runs WHERE id = '53000000-0000-0000-0000-00000000000b';
SELECT is(
	(SELECT count(*)::int FROM local_mentions WHERE run_id = '53000000-0000-0000-0000-00000000000b'),
	0,
	'deleting a run deletes its mentions'
);

SELECT * FROM finish(true);

ROLLBACK;
