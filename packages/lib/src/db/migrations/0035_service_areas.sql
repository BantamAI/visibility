CREATE TYPE "public"."sample_point_kind" AS ENUM('centroid', 'grid', 'zip');--> statement-breakpoint
CREATE TABLE "ref_us_places" (
	"geoid" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"state" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"land_area_m2" bigint NOT NULL,
	"google_canonical_name" text,
	"vintage" smallint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ref_us_places" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sample_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" text NOT NULL,
	"area_id" uuid NOT NULL,
	"kind" "sample_point_kind" NOT NULL,
	"label" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"city" text,
	"region" text,
	"country" text NOT NULL,
	"postal_code" text,
	"timezone" text NOT NULL,
	"google_canonical_name" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sample_points" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subject_service_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" text NOT NULL,
	"name" text NOT NULL,
	"center_lat" double precision NOT NULL,
	"center_lng" double precision NOT NULL,
	"radius_meters" integer NOT NULL,
	"polygon" jsonb,
	"is_primary" boolean DEFAULT false NOT NULL,
	"timezone" text NOT NULL,
	"country" text DEFAULT 'US' NOT NULL,
	"grid_size" smallint DEFAULT 3 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subject_service_areas_id_subject_id_key" UNIQUE("id","subject_id"),
	CONSTRAINT "subject_service_areas_center_lat_check" CHECK ("subject_service_areas"."center_lat" BETWEEN -90 AND 90),
	CONSTRAINT "subject_service_areas_center_lng_check" CHECK ("subject_service_areas"."center_lng" BETWEEN -180 AND 180),
	CONSTRAINT "subject_service_areas_radius_check" CHECK ("subject_service_areas"."radius_meters" BETWEEN 100 AND 200000),
	CONSTRAINT "subject_service_areas_grid_size_check" CHECK ("subject_service_areas"."grid_size" BETWEEN 3 AND 7)
);
--> statement-breakpoint
ALTER TABLE "subject_service_areas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sample_points" ADD CONSTRAINT "sample_points_area_fk" FOREIGN KEY ("area_id","subject_id") REFERENCES "public"."subject_service_areas"("id","subject_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_service_areas" ADD CONSTRAINT "subject_service_areas_subject_id_brands_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ref_us_places_lat_lng_idx" ON "ref_us_places" USING btree ("lat","lng");--> statement-breakpoint
CREATE INDEX "sample_points_subject_id_idx" ON "sample_points" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sample_points_area_id_kind_label_idx" ON "sample_points" USING btree ("area_id","kind","label");--> statement-breakpoint
CREATE INDEX "subject_service_areas_subject_id_idx" ON "subject_service_areas" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subject_service_areas_subject_id_name_idx" ON "subject_service_areas" USING btree ("subject_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "subject_service_areas_one_primary_idx" ON "subject_service_areas" USING btree ("subject_id") WHERE "subject_service_areas"."is_primary";--> statement-breakpoint
SELECT tenancy.scope_to_subject('subject_service_areas');
--> statement-breakpoint
SELECT tenancy.scope_to_subject('sample_points');
--> statement-breakpoint
SELECT tenancy.restrict_to_agency('ref_us_places', 'Public-domain Census places with Google geotarget names; holds no subject data.');
--> statement-breakpoint
-- Generating a subject's sample points reads it.
SELECT tenancy.share_with_subjects('ref_us_places', 'SELECT');
