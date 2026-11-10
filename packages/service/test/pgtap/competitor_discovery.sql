BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(18);

-- pgTAP records results in session temp tables owned by the test's login role.
DO $$
BEGIN
	EXECUTE format('GRANT USAGE ON SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
	EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
	EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
END $$;

INSERT INTO organization (id, name, slug, created_at) VALUES ('org-discovery', 'Test Agency', 'test-agency-discovery', now());
INSERT INTO brands (id, name, website, organization_id) VALUES
	('discovery-a', 'Plumber A', 'https://a.example', 'org-discovery'),
	('discovery-b', 'Plumber B', 'https://b.example', 'org-discovery');
INSERT INTO subject_service_areas (id, subject_id, name, center_lat, center_lng, radius_meters, timezone) VALUES
	('56000000-0000-0000-0000-00000000000a', 'discovery-a', 'Raleigh', 35.78, -78.64, 16000, 'America/New_York'),
	('56000000-0000-0000-0000-00000000000b', 'discovery-b', 'Denver', 39.74, -104.99, 16000, 'America/Denver');
INSERT INTO subject_services (id, subject_id, name) VALUES
	('57000000-0000-0000-0000-00000000000a', 'discovery-a', 'plumber'),
	('57000000-0000-0000-0000-00000000000b', 'discovery-b', 'plumber');
INSERT INTO competitor_discovery_settings (subject_id, min_runs, per_area, window_days) VALUES
	('discovery-a', 3, 10, 90),
	('discovery-b', 3, 10, 90);
INSERT INTO competitor_seed_searches (subject_id, area_id, service_id, search_query, found) VALUES
	('discovery-a', '56000000-0000-0000-0000-00000000000a', '57000000-0000-0000-0000-00000000000a', 'plumber', 1),
	('discovery-b', '56000000-0000-0000-0000-00000000000b', '57000000-0000-0000-0000-00000000000b', 'plumber', 1);
INSERT INTO area_competitors (subject_id, area_id, place_id, name, seed_rank) VALUES
	('discovery-a', '56000000-0000-0000-0000-00000000000a', 'ChIJtrianglerooter0001', 'Triangle Rooter', 1),
	('discovery-b', '56000000-0000-0000-0000-00000000000b', 'ChIJmilehighplumbing01', 'Mile High Plumbing', 1);

SELECT throws_ok(
	$$INSERT INTO area_competitors (subject_id, area_id, place_id, name)
		VALUES ('discovery-a', '56000000-0000-0000-0000-00000000000b', 'ChIJplanted00000000001', 'Planted')$$,
	'23503',
	NULL,
	'a competitor belongs to an area of its own subject'
);
SELECT throws_ok(
	$$INSERT INTO competitor_seed_searches (subject_id, area_id, service_id, search_query, found)
		VALUES ('discovery-a', '56000000-0000-0000-0000-00000000000a', '57000000-0000-0000-0000-00000000000b', 'plumber', 0)$$,
	'23503',
	NULL,
	'a seed search uses a service of its own subject'
);
SELECT throws_ok(
	$$INSERT INTO area_competitors (subject_id, area_id, place_id, name)
		VALUES ('discovery-a', '56000000-0000-0000-0000-00000000000a', 'ChIJtrianglerooter0001', 'Triangle Rooter')$$,
	'23505',
	NULL,
	'an area lists a listing once'
);
SELECT throws_ok(
	$$UPDATE area_competitors SET status = 'pinned' WHERE subject_id = 'discovery-a'$$,
	'23514',
	NULL,
	'a pin or ignore records who decided it'
);
SELECT throws_ok(
	$$INSERT INTO subject_services (subject_id, name) VALUES ('discovery-a', 'Plumber')$$,
	'23505',
	NULL,
	'a subject names a service once, whatever its case'
);

SET LOCAL ROLE visibility_subject;

SELECT is((SELECT count(*)::int FROM subject_services), 0, 'no subject set: services are hidden');
SELECT is((SELECT count(*)::int FROM area_competitors), 0, 'no subject set: competitors are hidden');

SET LOCAL app.subject_id = 'discovery-a';

SELECT results_eq($$SELECT name FROM area_competitors$$, $$VALUES ('Triangle Rooter')$$, 'subject sees only its own competitors');
SELECT results_eq($$SELECT subject_id FROM subject_services$$, $$VALUES ('discovery-a')$$, 'subject sees only its own services');
SELECT results_eq(
	$$SELECT subject_id FROM competitor_seed_searches$$,
	$$VALUES ('discovery-a')$$,
	'subject sees only its own seed searches'
);
SELECT results_eq(
	$$SELECT subject_id FROM competitor_discovery_settings$$,
	$$VALUES ('discovery-a')$$,
	'subject sees only its own settings'
);

UPDATE area_competitors SET name = 'Hijacked' WHERE subject_id = 'discovery-b';
UPDATE competitor_discovery_settings SET per_area = 1 WHERE subject_id = 'discovery-b';
DELETE FROM subject_services WHERE subject_id = 'discovery-b';

SELECT throws_ok(
	$$INSERT INTO area_competitors (subject_id, area_id, place_id, name)
		VALUES ('discovery-b', '56000000-0000-0000-0000-00000000000b', 'ChIJplanted00000000001', 'Planted')$$,
	'42501',
	NULL,
	'subject can''t add competitors to another subject'
);
SELECT throws_ok(
	$$INSERT INTO subject_services (subject_id, name) VALUES ('discovery-b', 'roofer')$$,
	'42501',
	NULL,
	'subject can''t add services to another subject'
);

RESET ROLE;

SELECT is(
	(SELECT name FROM area_competitors WHERE subject_id = 'discovery-b'),
	'Mile High Plumbing',
	'cross-subject update of a competitor changed nothing'
);
SELECT is(
	(SELECT per_area::int FROM competitor_discovery_settings WHERE subject_id = 'discovery-b'),
	10,
	'cross-subject update of settings changed nothing'
);
SELECT is(
	(SELECT count(*)::int FROM subject_services WHERE subject_id = 'discovery-b'),
	1,
	'cross-subject delete of a service removed nothing'
);

SET LOCAL ROLE visibility_agency;

SELECT is((SELECT count(*)::int FROM area_competitors), 2, 'agency sees every subject''s competitors');

RESET ROLE;

DELETE FROM subject_service_areas WHERE id = '56000000-0000-0000-0000-00000000000b';
SELECT is(
	(SELECT count(*)::int FROM area_competitors WHERE subject_id = 'discovery-b'),
	0,
	'deleting an area deletes its competitors'
);

SELECT * FROM finish(true);

ROLLBACK;
