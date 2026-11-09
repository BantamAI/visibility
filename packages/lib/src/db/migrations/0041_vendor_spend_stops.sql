CREATE TABLE "vendor_spend_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"spend_usd" numeric(12, 6) NOT NULL,
	"plan_usd" numeric(12, 6) NOT NULL,
	"stopped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resumed_at" timestamp with time zone,
	"resumed_by" text,
	CONSTRAINT "vendor_spend_stops_resumed_check" CHECK (("vendor_spend_stops"."resumed_at" IS NULL) = ("vendor_spend_stops"."resumed_by" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "vendor_spend_stops" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_spend_stops_active_provider_idx" ON "vendor_spend_stops" USING btree ("provider") WHERE "vendor_spend_stops"."resumed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "vendor_spend_stops_provider_resumed_at_idx" ON "vendor_spend_stops" USING btree ("provider","resumed_at");--> statement-breakpoint
SELECT tenancy.restrict_to_agency('vendor_spend_stops', 'Agency-wide vendor spend stops; holds no subject data.');
--> statement-breakpoint
-- Every run checks its vendor isn't stopped before it spends.
SELECT tenancy.share_with_subjects('vendor_spend_stops', 'SELECT');
