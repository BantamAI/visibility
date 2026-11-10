CREATE TYPE "public"."place_resolution" AS ENUM('matched', 'elsewhere', 'none');--> statement-breakpoint
ALTER TYPE "public"."local_mention_review" ADD VALUE 'namesake_place';--> statement-breakpoint
CREATE TABLE "answer_named_businesses" (
	"run_id" uuid NOT NULL,
	"subject_id" text NOT NULL,
	"position" smallint NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"phone" text,
	"address" text,
	"website" text,
	CONSTRAINT "answer_named_businesses_pk" PRIMARY KEY("run_id","position"),
	CONSTRAINT "answer_named_businesses_position_check" CHECK ("answer_named_businesses"."position" >= 1),
	CONSTRAINT "answer_named_businesses_name_key_check" CHECK (btrim("answer_named_businesses"."name_key") <> ''),
	CONSTRAINT "answer_named_businesses_phone_check" CHECK ("answer_named_businesses"."phone" ~ '^\+[0-9]{8,15}$')
);
--> statement-breakpoint
ALTER TABLE "answer_named_businesses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "place_resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" text NOT NULL,
	"name_key" text NOT NULL,
	"phone" text,
	"address" text,
	"resolution" "place_resolution" NOT NULL,
	"place_id" text,
	"cid" text,
	"search_query" text NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_resolutions_matched_check" CHECK (("place_resolutions"."resolution" = 'matched') = ("place_resolutions"."place_id" IS NOT NULL)),
	CONSTRAINT "place_resolutions_phone_check" CHECK ("place_resolutions"."phone" ~ '^\+[0-9]{8,15}$')
);
--> statement-breakpoint
ALTER TABLE "place_resolutions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "run_locations" ADD COLUMN "named_businesses_version" smallint;--> statement-breakpoint
ALTER TABLE "answer_named_businesses" ADD CONSTRAINT "answer_named_businesses_run_id_prompt_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."prompt_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "place_resolutions" ADD CONSTRAINT "place_resolutions_subject_id_brands_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answer_named_businesses_subject_id_name_key_idx" ON "answer_named_businesses" USING btree ("subject_id","name_key");--> statement-breakpoint
CREATE INDEX "place_resolutions_subject_id_idx" ON "place_resolutions" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "place_resolutions_subject_name_idx" ON "place_resolutions" USING btree ("subject_id","name_key",coalesce("phone", ''),coalesce("address", ''));--> statement-breakpoint
CREATE TRIGGER answer_named_businesses_subject BEFORE INSERT OR UPDATE ON "answer_named_businesses"
	FOR EACH ROW EXECUTE FUNCTION tenancy.subject_from_run();
--> statement-breakpoint
SELECT tenancy.scope_to_subject('answer_named_businesses');--> statement-breakpoint
SELECT tenancy.scope_to_subject('place_resolutions');
