BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(7);

-- pgTAP records results in session temp tables owned by the test's login role.
DO $$
BEGIN
	EXECUTE format('GRANT USAGE ON SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
	EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
	EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
END $$;

INSERT INTO local_news_sources (metro, domain) VALUES ('Pgtap City, TX', 'pgtap-gazette.example');

SELECT throws_ok(
	$$INSERT INTO local_news_sources (metro, domain) VALUES ('PGTAP CITY, TX', 'pgtap-gazette.example')$$,
	'23505',
	NULL,
	'a site is listed once per metro, whatever the metro''s case'
);
SELECT throws_ok(
	$$INSERT INTO local_news_sources (metro, domain) VALUES ('Pgtap City, TX', 'Pgtap-Herald.example')$$,
	'23514',
	NULL,
	'domains are stored lowercase'
);

SET LOCAL ROLE visibility_subject;
SELECT set_config('app.subject_id', 'local-news-a', true);

SELECT throws_ok(
	$$SELECT count(*) FROM local_news_sources$$,
	'42501',
	NULL,
	'subject-scoped work can''t read the list'
);
SELECT throws_ok(
	$$INSERT INTO local_news_sources (metro, domain) VALUES ('Pgtap City, TX', 'pgtap-herald.example')$$,
	'42501',
	NULL,
	'subject-scoped work can''t add a site'
);

RESET ROLE;
SET LOCAL ROLE visibility_agency;

SELECT is(
	(SELECT count(*)::int FROM local_news_sources WHERE metro = 'Pgtap City, TX'),
	1,
	'the agency role reads the list'
);
INSERT INTO local_news_sources (metro, domain, added_by) VALUES ('Pgtap City, TX', 'pgtap-herald.example', 'staff');
DELETE FROM local_news_sources WHERE domain = 'pgtap-gazette.example';
SELECT is(
	(SELECT array_agg(domain) FROM local_news_sources WHERE metro = 'Pgtap City, TX'),
	ARRAY['pgtap-herald.example'],
	'the agency role adds and removes sites'
);

RESET ROLE;
SET LOCAL ROLE visibility_app;

SELECT throws_ok(
	$$SELECT count(*) FROM local_news_sources$$,
	'42501',
	NULL,
	'the login role reaches nothing without switching'
);

SELECT * FROM finish();
ROLLBACK;
