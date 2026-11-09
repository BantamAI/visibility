CREATE TABLE "subject_run_schedules" (
	"subject_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"monthly_budget_usd" numeric(10, 2),
	"scan_interval_days" smallint DEFAULT 7 NOT NULL,
	"centroid_interval_days" smallint DEFAULT 1 NOT NULL,
	"repeats" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subject_run_schedules_budget_check" CHECK ("subject_run_schedules"."monthly_budget_usd" >= 0),
	CONSTRAINT "subject_run_schedules_enabled_needs_budget_check" CHECK (NOT "subject_run_schedules"."enabled" OR "subject_run_schedules"."monthly_budget_usd" IS NOT NULL),
	CONSTRAINT "subject_run_schedules_scan_interval_check" CHECK ("subject_run_schedules"."scan_interval_days" BETWEEN 1 AND 31),
	CONSTRAINT "subject_run_schedules_centroid_interval_check" CHECK ("subject_run_schedules"."centroid_interval_days" BETWEEN 1 AND 31),
	CONSTRAINT "subject_run_schedules_repeats_check" CHECK ("subject_run_schedules"."repeats" BETWEEN 1 AND 5)
);
--> statement-breakpoint
ALTER TABLE "subject_run_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subject_run_schedules" ADD CONSTRAINT "subject_run_schedules_subject_id_brands_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subject_run_schedules_subject_id_idx" ON "subject_run_schedules" USING btree ("subject_id");--> statement-breakpoint
SELECT tenancy.scope_to_subject('subject_run_schedules');
