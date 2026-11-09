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

INSERT INTO organization (id, name, slug, created_at) VALUES ('org-sched', 'Test Agency', 'test-agency-sched', now());
INSERT INTO brands (id, name, website, organization_id) VALUES
	('sched-a', 'Plumber A', 'https://a.example', 'org-sched'),
	('sched-b', 'Plumber B', 'https://b.example', 'org-sched'),
	('sched-c', 'Plumber C', 'https://c.example', 'org-sched');
INSERT INTO subject_run_schedules (subject_id, enabled, monthly_budget_usd) VALUES
	('sched-a', true, 25),
	('sched-b', true, 40);

SELECT throws_ok(
	$$INSERT INTO subject_run_schedules (subject_id, enabled) VALUES ('sched-c', true)$$,
	'23514',
	NULL,
	'an enabled schedule needs a budget'
);

SET LOCAL ROLE visibility_subject;

SELECT is((SELECT count(*)::int FROM subject_run_schedules), 0, 'no subject set: schedules are hidden');

SET LOCAL app.subject_id = 'sched-a';

SELECT results_eq(
	$$SELECT subject_id, monthly_budget_usd FROM subject_run_schedules$$,
	$$VALUES ('sched-a'::text, 25::numeric)$$,
	'subject sees only its own schedule'
);

UPDATE subject_run_schedules SET monthly_budget_usd = 1000 WHERE subject_id = 'sched-b';
DELETE FROM subject_run_schedules WHERE subject_id = 'sched-b';

SELECT throws_ok(
	$$INSERT INTO subject_run_schedules (subject_id, monthly_budget_usd) VALUES ('sched-c', 10)$$,
	'42501',
	NULL,
	'subject can''t write another subject''s schedule'
);
SELECT throws_ok(
	$$UPDATE subject_run_schedules SET subject_id = 'sched-c' WHERE subject_id = 'sched-a'$$,
	'42501',
	NULL,
	'subject can''t move its schedule to another subject'
);
SELECT lives_ok(
	$$UPDATE subject_run_schedules SET monthly_budget_usd = 30 WHERE subject_id = 'sched-a'$$,
	'subject can change its own budget'
);

RESET ROLE;

SELECT is(
	(SELECT monthly_budget_usd FROM subject_run_schedules WHERE subject_id = 'sched-b'),
	40::numeric,
	'cross-subject update and delete changed nothing'
);

SET LOCAL ROLE visibility_agency;

SELECT is((SELECT count(*)::int FROM subject_run_schedules), 2, 'agency sees every subject''s schedule');

RESET ROLE;

DELETE FROM brands WHERE id = 'sched-a';
SELECT is(
	(SELECT count(*)::int FROM subject_run_schedules WHERE subject_id = 'sched-a'),
	0,
	'deleting a subject deletes its schedule'
);

SELECT * FROM finish(true);

ROLLBACK;
