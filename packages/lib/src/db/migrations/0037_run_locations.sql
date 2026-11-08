CREATE TYPE "public"."fidelity_tier" AS ENUM('T1', 'T2', 'T3', 'T4', 'T5');--> statement-breakpoint
CREATE TYPE "public"."location_method" AS ENUM('geo_coordinate', 'egress_city', 'egress_region', 'api_user_location', 'prompt_only');--> statement-breakpoint
CREATE TYPE "public"."run_cost_source" AS ENUM('vendor', 'estimate');--> statement-breakpoint
CREATE TABLE "run_locations" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"subject_id" text NOT NULL,
	"point_id" uuid NOT NULL,
	"requested_location" jsonb NOT NULL,
	"location_method" "location_method" NOT NULL,
	"fidelity_tier" "fidelity_tier" NOT NULL,
	"vendor_reported_location" jsonb,
	"vendor_run_id" text,
	"cost_usd" numeric(12, 6),
	"cost_source" "run_cost_source",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_locations_method_matches_tier_check" CHECK (("run_locations"."fidelity_tier", "run_locations"."location_method") IN (('T1', 'geo_coordinate'), ('T2', 'egress_city'), ('T3', 'egress_region'), ('T4', 'api_user_location'), ('T5', 'prompt_only'))),
	CONSTRAINT "run_locations_cost_source_check" CHECK (("run_locations"."cost_usd" IS NULL) = ("run_locations"."cost_source" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "run_locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "run_locations" ADD CONSTRAINT "run_locations_run_id_prompt_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."prompt_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_locations_subject_id_idx" ON "run_locations" USING btree ("subject_id");--> statement-breakpoint
CREATE TRIGGER run_locations_subject BEFORE INSERT OR UPDATE ON "run_locations"
	FOR EACH ROW EXECUTE FUNCTION tenancy.subject_from_run();
--> statement-breakpoint
SELECT tenancy.scope_to_subject('run_locations');
