CREATE TYPE "public"."card_placement" AS ENUM('answer', 'local_pack');--> statement-breakpoint
CREATE TABLE "answer_businesses" (
	"run_id" uuid NOT NULL,
	"subject_id" text NOT NULL,
	"placement" "card_placement" NOT NULL,
	"position" smallint NOT NULL,
	"name" text NOT NULL,
	"place_id" text,
	"cid" text,
	"phone" text,
	"address" text,
	"lat" double precision,
	"lng" double precision,
	"rating" double precision,
	"review_count" integer,
	"website" text,
	CONSTRAINT "answer_businesses_pk" PRIMARY KEY("run_id","placement","position"),
	CONSTRAINT "answer_businesses_position_check" CHECK ("answer_businesses"."position" >= 1)
);
--> statement-breakpoint
ALTER TABLE "answer_businesses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "run_locations" ADD COLUMN "businesses_version" smallint;--> statement-breakpoint
ALTER TABLE "answer_businesses" ADD CONSTRAINT "answer_businesses_run_id_prompt_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."prompt_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answer_businesses_subject_id_idx" ON "answer_businesses" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "run_locations_businesses_version_idx" ON "run_locations" USING btree ("businesses_version");--> statement-breakpoint
CREATE TRIGGER answer_businesses_subject BEFORE INSERT OR UPDATE ON "answer_businesses"
	FOR EACH ROW EXECUTE FUNCTION tenancy.subject_from_run();
--> statement-breakpoint
SELECT tenancy.scope_to_subject('answer_businesses');
