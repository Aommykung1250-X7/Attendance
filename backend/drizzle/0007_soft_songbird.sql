ALTER TABLE "attendance" ADD COLUMN "offsite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "offsite_note" text;