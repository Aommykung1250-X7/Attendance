CREATE TYPE "public"."leave_duration" AS ENUM('full_day', 'morning', 'afternoon');--> statement-breakpoint
CREATE TYPE "public"."leave_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."leave_type" AS ENUM('sick', 'personal');--> statement-breakpoint
ALTER TYPE "public"."offsite_request_status" ADD VALUE 'cancelled';--> statement-breakpoint
CREATE TABLE "leave_request_days" (
	"id" text PRIMARY KEY NOT NULL,
	"leave_request_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"shift_id" text NOT NULL,
	"date" text NOT NULL,
	"portion" "leave_duration" NOT NULL,
	CONSTRAINT "leave_request_days_request_shift_date_uq" UNIQUE("leave_request_id","shift_id","date")
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"duration" "leave_duration" NOT NULL,
	"leave_type" "leave_type",
	"reason" text NOT NULL,
	"medical_certificate_path" text,
	"medical_certificate_pending" boolean DEFAULT false NOT NULL,
	"medical_certificate_received_at" timestamp with time zone,
	"status" "leave_request_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"reject_reason" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "checkin_latitude" double precision;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "checkin_longitude" double precision;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "checkin_accuracy_meters" double precision;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "checkin_distance_meters" double precision;--> statement-breakpoint
ALTER TABLE "offsite_requests" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "offsite_requests" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "late_grace_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "office_latitude" double precision DEFAULT 18.800523577253724 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "office_longitude" double precision DEFAULT 98.95073601100776 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "checkin_radius_meters" integer DEFAULT 200 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "max_location_accuracy_meters" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_request_days" ADD CONSTRAINT "leave_request_days_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request_days" ADD CONSTRAINT "leave_request_days_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_request_days" ADD CONSTRAINT "leave_request_days_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_request_days_shift_date_idx" ON "leave_request_days" USING btree ("shift_id","date");--> statement-breakpoint
CREATE INDEX "leave_request_days_employee_date_idx" ON "leave_request_days" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "leave_requests_employee_dates_idx" ON "leave_requests" USING btree ("employee_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "leave_requests_status_dates_idx" ON "leave_requests" USING btree ("status","start_date","end_date");