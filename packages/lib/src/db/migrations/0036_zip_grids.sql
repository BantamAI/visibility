CREATE TABLE "ref_us_zctas" (
	"zcta" text PRIMARY KEY NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"land_area_m2" bigint NOT NULL,
	"population" integer,
	"vintage" smallint NOT NULL,
	"population_vintage" smallint
);
--> statement-breakpoint
ALTER TABLE "ref_us_zctas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subject_service_areas" ADD COLUMN "zip_point_limit" smallint DEFAULT 12 NOT NULL;--> statement-breakpoint
CREATE INDEX "ref_us_zctas_lat_lng_idx" ON "ref_us_zctas" USING btree ("lat","lng");--> statement-breakpoint
ALTER TABLE "subject_service_areas" ADD CONSTRAINT "subject_service_areas_zip_point_limit_check" CHECK ("subject_service_areas"."zip_point_limit" BETWEEN 1 AND 50);--> statement-breakpoint
SELECT tenancy.restrict_to_agency('ref_us_zctas', 'Public-domain Census ZCTA points and population; holds no subject data.');
--> statement-breakpoint
-- Generating a subject's sample points reads it.
SELECT tenancy.share_with_subjects('ref_us_zctas', 'SELECT');
