ALTER TABLE "apps" ADD COLUMN "slack_webhook_url" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "slack_events" jsonb DEFAULT '["guide_created","guide_updated"]'::jsonb NOT NULL;