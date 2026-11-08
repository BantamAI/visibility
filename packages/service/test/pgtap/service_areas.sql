BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(16);

-- pgTAP records results in session temp tables owned by the test's login role.
DO $$
BEGIN
	EXECUTE format('GRANT USAGE ON SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
	EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
	EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %s TO visibility_subject, visibility_agency', pg_my_temp_schema()::regnamespace);
END $$;

INSERT INTO organization (id, name, slug, created_at) VALUES ('org-areas', 'Test Agency', 'test-agency-areas', now());
INSERT INTO brands (id, name, website, organization_id) VALUES
	('areas-a', 'Plumber A', 'https://a.example', 'org-areas'),
	('areas-b', 'Plumber B', 'https://b.example', 'org-areas');
INSERT INTO subject_service_areas (id, subject_id, name, center_lat, center_lng, radius_meters, timezone, is_primary) VALUES
	('20000000-0000-0000-0000-00000000000a', 'areas-a', 'Raleigh', 35.78, -78.64, 16000, 'America/New_York', true),
	('20000000-0000-0000-0000-00000000000b', 'areas-b', 'Durham', 35.99, -78.9, 12000, 'America/New_York', true);
INSERT INTO sample_points (subject_id, area_id, kind, label, lat, lng, city, region, country, timezone) VALUES
	('areas-a', '20000000-0000-0000-0000-00000000000a', 'centroid', 'Raleigh, NC', 35.83, -78.64, 'Raleigh', 'NC', 'US', 'America/New_York'),
	('areas-b', '20000000-0000-0000-0000-00000000000b', 'centroid', 'Durham, NC', 35.98, -78.9, 'Durham', 'NC', 'US', 'America/New_York');
INSERT INTO ref_us_places (geoid, name, state, lat, lng, land_area_m2, vintage) VALUES
	('3755000', 'Raleigh', 'NC', 35.831868, -78.641042, 394359593, 2025);

SELECT throws_ok(
	$$INSERT INTO sample_points (subject_id, area_id, kind, label, lat, lng, country, timezone)
		VALUES ('areas-a', '20000000-0000-0000-0000-00000000000b', 'grid', 'planted', 35.9, -78.9, 'US', 'America/New_York')$$,
	'23503',
	NULL,
	'a point can''t belong to another subject''s area'
);

SET LOCAL ROLE visibility_subject;

SELECT is((SELECT count(*)::int FROM subject_service_areas), 0, 'no subject set: service areas are hidden');
SELECT is((SELECT count(*)::int FROM sample_points), 0, 'no subject set: sample points are hidden');

SET LOCAL app.subject_id = 'areas-a';

SELECT results_eq('SELECT name FROM subject_service_areas', $$VALUES ('Raleigh')$$, 'subject sees only its own areas');
SELECT results_eq('SELECT label FROM sample_points', $$VALUES ('Raleigh, NC')$$, 'subject sees only its own points');
SELECT is((SELECT count(*)::int FROM ref_us_places), 1, 'subject reads the shared reference places');

UPDATE subject_service_areas SET name = 'hijacked' WHERE subject_id = 'areas-b';
UPDATE sample_points SET active = false WHERE subject_id = 'areas-b';
DELETE FROM sample_points WHERE subject_id = 'areas-b';

SELECT throws_ok(
	$$INSERT INTO subject_service_areas (subject_id, name, center_lat, center_lng, radius_meters, timezone)
		VALUES ('areas-b', 'planted', 35.9, -78.9, 5000, 'America/New_York')$$,
	'42501',
	NULL,
	'subject can''t add areas for another subject'
);
SELECT throws_ok(
	$$INSERT INTO sample_points (subject_id, area_id, kind, label, lat, lng, country, timezone)
		VALUES ('areas-b', '20000000-0000-0000-0000-00000000000b', 'grid', 'planted', 35.9, -78.9, 'US', 'America/New_York')$$,
	'42501',
	NULL,
	'subject can''t add points for another subject'
);
SELECT throws_ok(
	$$UPDATE subject_service_areas SET subject_id = 'areas-b' WHERE subject_id = 'areas-a'$$,
	'42501',
	NULL,
	'subject can''t move its areas to another subject'
);
SELECT lives_ok(
	$$INSERT INTO sample_points (subject_id, area_id, kind, label, lat, lng, country, timezone)
		VALUES ('areas-a', '20000000-0000-0000-0000-00000000000a', 'grid', '3x3 R2C2', 35.78, -78.64, 'US', 'America/New_York')$$,
	'subject can add points to its own area'
);
SELECT throws_ok(
	$$INSERT INTO ref_us_places (geoid, name, state, lat, lng, land_area_m2, vintage)
		VALUES ('0000000', 'Planted', 'NC', 35, -78, 1, 2025)$$,
	'42501',
	NULL,
	'subject can''t change the reference places'
);

RESET ROLE;

SELECT is(
	(SELECT name FROM subject_service_areas WHERE subject_id = 'areas-b'),
	'Durham',
	'cross-subject update changed nothing'
);
SELECT is(
	(SELECT count(*)::int FROM sample_points WHERE subject_id = 'areas-b' AND active),
	1,
	'cross-subject point update and delete changed nothing'
);

SET LOCAL ROLE visibility_agency;

SELECT is((SELECT count(*)::int FROM subject_service_areas), 2, 'agency sees every subject''s areas');

RESET ROLE;

DELETE FROM brands WHERE id = 'areas-b';
SELECT is((SELECT count(*)::int FROM subject_service_areas WHERE subject_id = 'areas-b'), 0, 'deleting a subject deletes its areas');
SELECT is((SELECT count(*)::int FROM sample_points WHERE subject_id = 'areas-b'), 0, '... and their points');

SELECT * FROM finish(true);

ROLLBACK;
