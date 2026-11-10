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

INSERT INTO organization (id, name, slug, created_at) VALUES ('org-contacts', 'Test Agency', 'test-agency-contacts', now());
INSERT INTO brands (id, name, website, organization_id) VALUES
	('contacts-a', 'Plumber A', 'https://a.example', 'org-contacts'),
	('contacts-b', 'Plumber B', 'https://b.example', 'org-contacts');
INSERT INTO business_contacts (subject_id, competitor_name, phone, address, updated_by) VALUES
	('contacts-a', NULL, '+19195550100', '1 Main St, Raleigh, NC', 'staff'),
	('contacts-a', 'Rival', '+19195550111', NULL, 'staff'),
	('contacts-b', NULL, '+13035550100', NULL, 'staff');

SELECT throws_ok(
	$$INSERT INTO business_contacts (subject_id, competitor_name, phone, updated_by)
		VALUES ('contacts-a', 'RIVAL', '+19195550122', 'staff')$$,
	'23505',
	NULL,
	'a competitor has one contact, whatever the case of its name'
);
SELECT throws_ok(
	$$INSERT INTO business_contacts (subject_id, competitor_name, phone, updated_by)
		VALUES ('contacts-a', 'Third', '(919) 555-0133', 'staff')$$,
	'23514',
	NULL,
	'phones are stored in E.164'
);

SET LOCAL ROLE visibility_subject;

SELECT is((SELECT count(*)::int FROM business_contacts), 0, 'no subject set: contacts are hidden');

SET LOCAL app.subject_id = 'contacts-a';

SELECT results_eq(
	$$SELECT phone FROM business_contacts ORDER BY phone$$,
	$$VALUES ('+19195550100'), ('+19195550111')$$,
	'subject sees only its own contacts'
);

UPDATE business_contacts SET phone = '+10000000000' WHERE subject_id = 'contacts-b';
DELETE FROM business_contacts WHERE subject_id = 'contacts-b';

SELECT throws_ok(
	$$INSERT INTO business_contacts (subject_id, competitor_name, phone, updated_by)
		VALUES ('contacts-b', 'Planted', '+13035550199', 'staff')$$,
	'42501',
	NULL,
	'subject can''t add a contact to another subject'
);
SELECT throws_ok(
	$$UPDATE business_contacts SET subject_id = 'contacts-b' WHERE competitor_name = 'Rival'$$,
	'42501',
	NULL,
	'subject can''t move its contact to another subject'
);
SELECT lives_ok(
	$$INSERT INTO business_contacts (subject_id, competitor_name, phone, updated_by)
		VALUES ('contacts-a', 'Other Rival', '+19195550144', 'staff')$$,
	'subject can record its own competitor''s contact'
);

RESET ROLE;

SELECT is(
	(SELECT phone FROM business_contacts WHERE subject_id = 'contacts-b'),
	'+13035550100',
	'cross-subject update and delete changed nothing'
);

SET LOCAL ROLE visibility_agency;

SELECT is((SELECT count(*)::int FROM business_contacts), 4, 'agency sees every subject''s contacts');

RESET ROLE;

DELETE FROM brands WHERE id = 'contacts-b';
SELECT is(
	(SELECT count(*)::int FROM business_contacts WHERE subject_id = 'contacts-b'),
	0,
	'deleting a subject deletes its contacts'
);

SELECT * FROM finish(true);

ROLLBACK;
