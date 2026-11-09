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

INSERT INTO organization (id, name, slug, created_at) VALUES ('org-anchors', 'Test Agency', 'test-agency-anchors', now());
INSERT INTO brands (id, name, website, organization_id) VALUES
	('anchors-a', 'Plumber A', 'https://a.example', 'org-anchors'),
	('anchors-b', 'Plumber B', 'https://b.example', 'org-anchors');
INSERT INTO place_anchors (subject_id, competitor_name, place_id, search_query, confirmed_by) VALUES
	('anchors-a', NULL, 'ChIJaaaaaaaaaaaaaaaa', 'Plumber A', 'staff'),
	('anchors-a', 'Rival', 'ChIJrrrrrrrrrrrrrrrr', 'Rival', 'staff'),
	('anchors-b', NULL, 'ChIJbbbbbbbbbbbbbbbb', 'Plumber B', 'staff');

SELECT throws_ok(
	$$INSERT INTO place_anchors (subject_id, competitor_name, place_id, search_query, confirmed_by)
		VALUES ('anchors-a', NULL, 'ChIJcccccccccccccccc', 'Plumber A', 'staff')$$,
	'23505',
	NULL,
	'a subject has one anchor of its own'
);
SELECT throws_ok(
	$$INSERT INTO place_anchors (subject_id, competitor_name, place_id, search_query, confirmed_by)
		VALUES ('anchors-a', 'RIVAL', 'ChIJcccccccccccccccc', 'Rival', 'staff')$$,
	'23505',
	NULL,
	'a competitor has one anchor, whatever the case of its name'
);

SET LOCAL ROLE visibility_subject;

SELECT is((SELECT count(*)::int FROM place_anchors), 0, 'no subject set: anchors are hidden');

SET LOCAL app.subject_id = 'anchors-a';

SELECT results_eq(
	$$SELECT place_id FROM place_anchors ORDER BY place_id$$,
	$$VALUES ('ChIJaaaaaaaaaaaaaaaa'), ('ChIJrrrrrrrrrrrrrrrr')$$,
	'subject sees only its own anchors'
);

UPDATE place_anchors SET place_id = 'ChIJhijackedhijacked' WHERE subject_id = 'anchors-b';
DELETE FROM place_anchors WHERE subject_id = 'anchors-b';

SELECT throws_ok(
	$$INSERT INTO place_anchors (subject_id, competitor_name, place_id, search_query, confirmed_by)
		VALUES ('anchors-b', 'Planted', 'ChIJpppppppppppppppp', 'Planted', 'staff')$$,
	'42501',
	NULL,
	'subject can''t anchor another subject''s competitor'
);
SELECT throws_ok(
	$$UPDATE place_anchors SET subject_id = 'anchors-b' WHERE competitor_name = 'Rival'$$,
	'42501',
	NULL,
	'subject can''t move its anchor to another subject'
);
SELECT lives_ok(
	$$INSERT INTO place_anchors (subject_id, competitor_name, place_id, search_query, confirmed_by)
		VALUES ('anchors-a', 'Other Rival', 'ChIJoooooooooooooooo', 'Other Rival', 'staff')$$,
	'subject can anchor its own competitor'
);

RESET ROLE;

SELECT is(
	(SELECT place_id FROM place_anchors WHERE subject_id = 'anchors-b'),
	'ChIJbbbbbbbbbbbbbbbb',
	'cross-subject update and delete changed nothing'
);

SET LOCAL ROLE visibility_agency;

SELECT is((SELECT count(*)::int FROM place_anchors), 4, 'agency sees every subject''s anchors');

RESET ROLE;

DELETE FROM brands WHERE id = 'anchors-b';
SELECT is(
	(SELECT count(*)::int FROM place_anchors WHERE subject_id = 'anchors-b'),
	0,
	'deleting a subject deletes its anchors'
);

SELECT * FROM finish(true);

ROLLBACK;
