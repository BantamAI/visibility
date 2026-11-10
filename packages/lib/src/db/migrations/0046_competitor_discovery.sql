CREATE TYPE "public"."area_competitor_status" AS ENUM('auto', 'pinned', 'ignored');--> statement-breakpoint
CREATE TABLE "area_competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" text NOT NULL,
	"area_id" uuid NOT NULL,
	"place_id" text NOT NULL,
	"cid" text,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"website" text,
	"status" "area_competitor_status" DEFAULT 'auto' NOT NULL,
	"status_by" text,
	"status_at" timestamp with time zone,
	"seed_rank" smallint,
	"answer_runs" integer DEFAULT 0 NOT NULL,
	"services" text[] DEFAULT '{}' NOT NULL,
	"tracked" boolean DEFAULT false NOT NULL,
	"owns_competitor" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "area_competitors_name_check" CHECK (btrim("area_competitors"."name") <> ''),
	CONSTRAINT "area_competitors_answer_runs_check" CHECK ("area_competitors"."answer_runs" >= 0),
	CONSTRAINT "area_competitors_status_check" CHECK (("area_competitors"."status" = 'auto') = ("area_competitors"."status_by" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "area_competitors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "competitor_discovery_settings" (
	"subject_id" text PRIMARY KEY NOT NULL,
	"min_runs" smallint NOT NULL,
	"per_area" smallint NOT NULL,
	"window_days" smallint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitor_discovery_settings_min_runs_check" CHECK ("competitor_discovery_settings"."min_runs" BETWEEN 1 AND 100),
	CONSTRAINT "competitor_discovery_settings_per_area_check" CHECK ("competitor_discovery_settings"."per_area" BETWEEN 1 AND 50),
	CONSTRAINT "competitor_discovery_settings_window_days_check" CHECK ("competitor_discovery_settings"."window_days" BETWEEN 7 AND 365)
);
--> statement-breakpoint
ALTER TABLE "competitor_discovery_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "competitor_seed_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" text NOT NULL,
	"area_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"search_query" text NOT NULL,
	"found" smallint NOT NULL,
	"searched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "competitor_seed_searches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subject_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subject_services_id_subject_id_key" UNIQUE("id","subject_id"),
	CONSTRAINT "subject_services_name_check" CHECK (btrim("subject_services"."name") <> '' AND "subject_services"."name" = btrim("subject_services"."name"))
);
--> statement-breakpoint
ALTER TABLE "subject_services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "area_competitors" ADD CONSTRAINT "area_competitors_area_fk" FOREIGN KEY ("area_id","subject_id") REFERENCES "public"."subject_service_areas"("id","subject_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_discovery_settings" ADD CONSTRAINT "competitor_discovery_settings_subject_id_brands_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_seed_searches" ADD CONSTRAINT "competitor_seed_searches_area_fk" FOREIGN KEY ("area_id","subject_id") REFERENCES "public"."subject_service_areas"("id","subject_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_seed_searches" ADD CONSTRAINT "competitor_seed_searches_service_fk" FOREIGN KEY ("service_id","subject_id") REFERENCES "public"."subject_services"("id","subject_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_services" ADD CONSTRAINT "subject_services_subject_id_brands_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "area_competitors_subject_id_idx" ON "area_competitors" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "area_competitors_area_place_idx" ON "area_competitors" USING btree ("area_id","place_id");--> statement-breakpoint
CREATE INDEX "competitor_seed_searches_subject_id_idx" ON "competitor_seed_searches" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_seed_searches_area_service_idx" ON "competitor_seed_searches" USING btree ("area_id","service_id");--> statement-breakpoint
CREATE INDEX "subject_services_subject_id_idx" ON "subject_services" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subject_services_subject_name_idx" ON "subject_services" USING btree ("subject_id",lower("name"));--> statement-breakpoint
SELECT tenancy.scope_to_subject('subject_services');--> statement-breakpoint
SELECT tenancy.scope_to_subject('competitor_discovery_settings');--> statement-breakpoint
SELECT tenancy.scope_to_subject('competitor_seed_searches');--> statement-breakpoint
SELECT tenancy.scope_to_subject('area_competitors');
