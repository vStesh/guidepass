ALTER TABLE "results" ADD COLUMN "evidence" text;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "issue_url" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "build" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "commit" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "account" text;