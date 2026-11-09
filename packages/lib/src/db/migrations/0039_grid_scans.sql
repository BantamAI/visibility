CREATE TYPE "public"."grid_scan_run_status" AS ENUM('pending', 'answered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."grid_scan_status" AS ENUM('running', 'complete');--> statement-breakpoint
CREATE TABLE "grid_scan_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" text NOT NULL,
	"scan_id" uuid NOT NULL,
	"point_id" uuid NOT NULL,
	"location" jsonb NOT NULL,
	"repeat" smallint NOT NULL,
	"status" "grid_scan_run_status" DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"run_id" uuid,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grid_scan_runs_answered_check" CHECK (("grid_scan_runs"."status" = 'answered') = ("grid_scan_runs"."run_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "grid_scan_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "grid_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" text NOT NULL,
	"area_id" uuid NOT NULL,
	"prompt_id" uuid NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"web_search_enabled" boolean NOT NULL,
	"version" text,
	"fidelity_tier" "fidelity_tier" NOT NULL,
	"point_kind" "sample_point_kind" NOT NULL,
	"repeats" smallint NOT NULL,
	"uncovered" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_cost_usd" numeric(12, 6),
	"status" "grid_scan_status" DEFAULT 'running' NOT NULL,
	"points_planned" integer NOT NULL,
	"points_answered" integer,
	"cost_usd" numeric(12, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "grid_scans_id_subject_id_key" UNIQUE("id","subject_id"),
	CONSTRAINT "grid_scans_repeats_check" CHECK ("grid_scans"."repeats" >= 1),
	CONSTRAINT "grid_scans_points_planned_check" CHECK ("grid_scans"."points_planned" >= 1),
	CONSTRAINT "grid_scans_complete_check" CHECK (("grid_scans"."status" = 'complete') = ("grid_scans"."completed_at" IS NOT NULL AND "grid_scans"."points_answered" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "grid_scans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "grid_scan_runs" ADD CONSTRAINT "grid_scan_runs_run_id_prompt_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."prompt_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grid_scan_runs" ADD CONSTRAINT "grid_scan_runs_scan_fk" FOREIGN KEY ("scan_id","subject_id") REFERENCES "public"."grid_scans"("id","subject_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grid_scans" ADD CONSTRAINT "grid_scans_subject_id_brands_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grid_scans" ADD CONSTRAINT "grid_scans_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grid_scan_runs_subject_id_idx" ON "grid_scan_runs" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grid_scan_runs_scan_id_point_id_repeat_idx" ON "grid_scan_runs" USING btree ("scan_id","point_id","repeat");--> statement-breakpoint
CREATE UNIQUE INDEX "grid_scan_runs_run_id_idx" ON "grid_scan_runs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "grid_scans_subject_id_idx" ON "grid_scans" USING btree ("subject_id","created_at");--> statement-breakpoint
SELECT tenancy.scope_to_subject('grid_scans');--> statement-breakpoint
SELECT tenancy.scope_to_subject('grid_scan_runs');
