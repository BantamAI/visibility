BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(9);

-- pgTAP records results in session temp tables owned by the test's login role.
DO $$
BEGIN
	EXECUTE format('GRANT USAGE ON SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
	EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
	EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
END $$;

INSERT INTO organization (id, name, slug, created_at) VALUES ('org-cards', 'Test Agency', 'test-agency-cards', now());
INSERT INTO brands (id, name, website, organization_id) VALUES
	('cards-a', 'Plumber A', 'https://a.example', 'org-cards'),
	('cards-b', 'Plumber B', 'https://b.example', 'org-cards');
INSERT INTO prompts (id, brand_id, value) VALUES
	('50000000-0000-0000-0000-00000000000a', 'cards-a', 'plumber near me'),
	('50000000-0000-0000-0000-00000000000b', 'cards-b', 'plumber near me');
INSERT INTO prompt_runs (id, prompt_id, brand_id, model, version, web_search_enabled, raw_output) VALUES
	('51000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-00000000000a', 'cards-a', 'google-ai-mode', 'v1', true, '{}'),
	('51000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-00000000000b', 'cards-b', 'google-ai-mode', 'v1', true, '{}');
INSERT INTO answer_businesses (run_id, subject_id, placement, position, name, cid) VALUES
	('51000000-0000-0000-0000-00000000000a', 'cards-b', 'answer', 1, 'Acme Plumbing', '123'),
	('51000000-0000-0000-0000-00000000000b', 'cards-b', 'answer', 1, 'Beta Plumbing', '456');

SELECT is(
	(SELECT subject_id FROM answer_businesses WHERE name = 'Acme Plumbing'),
	'cards-a',
	'a card takes its run''s subject, whatever the writer claimed'
);
SELECT throws_ok(
	$$INSERT INTO answer_businesses (run_id, subject_id, placement, position, name)
		VALUES ('51000000-0000-0000-0000-00000000000a', 'cards-a', 'answer', 0, 'Zero')$$,
	'23514',
	NULL,
	'positions start at 1'
);

SET LOCAL ROLE visibility_subject;

SELECT is((SELECT count(*)::int FROM answer_businesses), 0, 'no subject set: cards are hidden');

SET LOCAL app.subject_id = 'cards-a';

SELECT results_eq(
	$$SELECT name FROM answer_businesses$$,
	$$VALUES ('Acme Plumbing')$$,
	'subject sees only its own runs'' cards'
);

UPDATE answer_businesses SET name = 'hijacked' WHERE name = 'Beta Plumbing';
DELETE FROM answer_businesses WHERE name = 'Beta Plumbing';

SELECT throws_ok(
	$$INSERT INTO answer_businesses (run_id, subject_id, placement, position, name)
		VALUES ('51000000-0000-0000-0000-00000000000b', 'cards-a', 'local_pack', 1, 'Planted')$$,
	'42501',
	NULL,
	'subject can''t add cards to another subject''s run'
);
SELECT lives_ok(
	$$INSERT INTO answer_businesses (run_id, subject_id, placement, position, name)
		VALUES ('51000000-0000-0000-0000-00000000000a', 'cards-a', 'local_pack', 1, 'Acme Plumbing')$$,
	'subject can record its own run''s cards'
);

RESET ROLE;

SELECT is(
	(SELECT count(*)::int FROM answer_businesses WHERE name = 'Beta Plumbing'),
	1,
	'cross-subject update and delete changed nothing'
);

SET LOCAL ROLE visibility_agency;

SELECT is((SELECT count(*)::int FROM answer_businesses), 3, 'agency sees every subject''s cards');

RESET ROLE;

DELETE FROM prompt_runs WHERE id = '51000000-0000-0000-0000-00000000000b';
SELECT is(
	(SELECT count(*)::int FROM answer_businesses WHERE run_id = '51000000-0000-0000-0000-00000000000b'),
	0,
	'deleting a run deletes its cards'
);

SELECT * FROM finish(true);

ROLLBACK;
