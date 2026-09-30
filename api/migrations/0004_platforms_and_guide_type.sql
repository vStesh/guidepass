ALTER TABLE "apps" ADD COLUMN "platform_names" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "guides" ADD COLUMN "type" text;