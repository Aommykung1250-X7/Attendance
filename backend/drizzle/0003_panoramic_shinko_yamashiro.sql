CREATE TYPE "public"."offsite_request_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."override_status" ADD VALUE 'offsite';--> statement-breakpoint
CREATE TABLE "offsite_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"shift_id" text NOT NULL,
	"date" text NOT NULL,
	"task_description" text NOT NULL,
	"photo_path" text NOT NULL,
	"latitude" text NOT NULL,
	"longitude" text NOT NULL,
	"location_name" text,
	"status" "offsite_request_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "is_offsite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "line_oa_url" text;--> statement-breakpoint
ALTER TABLE "offsite_requests" ADD CONSTRAINT "offsite_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offsite_requests" ADD CONSTRAINT "offsite_requests_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offsite_requests_employee_date_idx" ON "offsite_requests" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "offsite_requests_status_date_idx" ON "offsite_requests" USING btree ("status","date");