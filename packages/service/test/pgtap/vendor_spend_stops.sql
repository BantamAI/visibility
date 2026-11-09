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

INSERT INTO vendor_spend_stops (provider, spend_usd, plan_usd) VALUES ('pgtap-vendor', 3, 1);

SELECT throws_ok(
	$$INSERT INTO vendor_spend_stops (provider, spend_usd, plan_usd) VALUES ('pgtap-vendor', 5, 1)$$,
	'23505',
	NULL,
	'a vendor has at most one stop in force'
);

SET LOCAL ROLE visibility_subject;
SELECT set_config('app.subject_id', 'stops-a', true);

SELECT is(
	(SELECT count(*)::int FROM vendor_spend_stops WHERE provider = 'pgtap-vendor'),
	1,
	'subject-scoped work sees which vendors are stopped'
);
SELECT throws_ok(
	$$UPDATE vendor_spend_stops SET resumed_at = now(), resumed_by = 'subject' WHERE provider = 'pgtap-vendor'$$,
	'42501',
	NULL,
	'subject-scoped work can''t resume a vendor'
);
SELECT throws_ok(
	$$INSERT INTO vendor_spend_stops (provider, spend_usd, plan_usd) VALUES ('pgtap-other', 1, 0)$$,
	'42501',
	NULL,
	'subject-scoped work can''t stop a vendor'
);
SELECT throws_ok(
	$$DELETE FROM vendor_spend_stops$$,
	'42501',
	NULL,
	'subject-scoped work can''t clear stops'
);

RESET ROLE;
SET LOCAL ROLE visibility_agency;

UPDATE vendor_spend_stops SET resumed_at = now(), resumed_by = 'staff' WHERE provider = 'pgtap-vendor';
SELECT is(
	(SELECT resumed_by FROM vendor_spend_stops WHERE provider = 'pgtap-vendor'),
	'staff',
	'the agency role resumes a vendor'
);

RESET ROLE;

SELECT throws_ok(
	$$UPDATE vendor_spend_stops SET resumed_by = NULL WHERE provider = 'pgtap-vendor'$$,
	'23514',
	NULL,
	'a resumed stop records who resumed it'
);

SELECT * FROM finish();
ROLLBACK;
