-- Existing tokens are held by the owner who created them.
ALTER TABLE "agent_tokens" ADD COLUMN "user_id" text;--> statement-breakpoint
UPDATE "agent_tokens" SET "user_id" = "created_by";--> statement-breakpoint
ALTER TABLE "agent_tokens" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Agent uploads now record the person too, at upload time; until now that was the token's creator.
UPDATE "guide_versions" v SET "created_by_user_id" = t."created_by" FROM "agent_tokens" t WHERE v."created_by_token_id" = t."id" AND v."created_by_user_id" IS NULL;--> statement-breakpoint
-- Tokens held by people who already left the team stop working.
UPDATE "agent_tokens" t SET "revoked_at" = now() WHERE t."revoked_at" IS NULL AND NOT EXISTS (SELECT 1 FROM "memberships" m WHERE m."team_id" = t."team_id" AND m."user_id" = t."user_id");
