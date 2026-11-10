CREATE TABLE "place_anchors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" text NOT NULL,
	"competitor_name" text,
	"place_id" text NOT NULL,
	"cid" text,
	"search_query" text NOT NULL,
	"confirmed_by" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"obsolete_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_anchors_competitor_name_check" CHECK ("place_anchors"."competitor_name" IS NULL OR btrim("place_anchors"."competitor_name") <> '')
);
--> statement-breakpoint
ALTER TABLE "place_anchors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "place_anchors" ADD CONSTRAINT "place_anchors_subject_id_brands_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "place_anchors_subject_id_idx" ON "place_anchors" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "place_anchors_subject_idx" ON "place_anchors" USING btree ("subject_id") WHERE "place_anchors"."competitor_name" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "place_anchors_competitor_idx" ON "place_anchors" USING btree ("subject_id",lower("competitor_name")) WHERE "place_anchors"."competitor_name" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "place_anchors_checked_at_idx" ON "place_anchors" USING btree ("checked_at");--> statement-breakpoint
SELECT tenancy.scope_to_subject('place_anchors');
