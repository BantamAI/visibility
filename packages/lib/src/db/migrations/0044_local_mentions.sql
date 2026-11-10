CREATE TYPE "public"."local_match_method" AS ENUM('place_id', 'cid', 'phone', 'url', 'text+jev', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."local_mention_review" AS ENUM('unresolved', 'conflicting_card');--> statement-breakpoint
CREATE TABLE "business_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" text NOT NULL,
	"competitor_name" text,
	"phone" text,
	"address" text,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_contacts_competitor_name_check" CHECK ("business_contacts"."competitor_name" IS NULL OR btrim("business_contacts"."competitor_name") <> ''),
	CONSTRAINT "business_contacts_phone_check" CHECK ("business_contacts"."phone" ~ '^\+[0-9]{8,15}$'),
	CONSTRAINT "business_contacts_address_check" CHECK ("business_contacts"."address" IS NULL OR btrim("business_contacts"."address") <> '')
);
--> statement-breakpoint
ALTER TABLE "business_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "local_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"subject_id" text NOT NULL,
	"competitor_name" text,
	"counted" boolean NOT NULL,
	"method" "local_match_method" NOT NULL,
	"confidence" double precision NOT NULL,
	"review" "local_mention_review",
	"card_placement" "card_placement",
	"card_position" smallint,
	CONSTRAINT "local_mentions_confidence_check" CHECK ("local_mentions"."confidence" BETWEEN 0 AND 1),
	CONSTRAINT "local_mentions_card_check" CHECK (("local_mentions"."card_placement" IS NULL) = ("local_mentions"."card_position" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "local_mentions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "run_locations" ADD COLUMN "local_mentions_stamp" text;--> statement-breakpoint
ALTER TABLE "business_contacts" ADD CONSTRAINT "business_contacts_subject_id_brands_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_mentions" ADD CONSTRAINT "local_mentions_run_id_prompt_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."prompt_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_contacts_subject_id_idx" ON "business_contacts" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_contacts_subject_idx" ON "business_contacts" USING btree ("subject_id") WHERE "business_contacts"."competitor_name" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "business_contacts_competitor_idx" ON "business_contacts" USING btree ("subject_id",lower("competitor_name")) WHERE "business_contacts"."competitor_name" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "local_mentions_subject_id_idx" ON "local_mentions" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "local_mentions_run_subject_idx" ON "local_mentions" USING btree ("run_id") WHERE "local_mentions"."competitor_name" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "local_mentions_run_competitor_idx" ON "local_mentions" USING btree ("run_id",lower("competitor_name")) WHERE "local_mentions"."competitor_name" IS NOT NULL;--> statement-breakpoint
CREATE TRIGGER local_mentions_subject BEFORE INSERT OR UPDATE ON "local_mentions"
	FOR EACH ROW EXECUTE FUNCTION tenancy.subject_from_run();
--> statement-breakpoint
SELECT tenancy.scope_to_subject('business_contacts');--> statement-breakpoint
SELECT tenancy.scope_to_subject('local_mentions');
