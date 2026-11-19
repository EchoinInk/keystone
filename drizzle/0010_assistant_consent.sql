ALTER TABLE `ai_conversations` ADD `provider_status` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_conversations` ADD `provider_issue` text;--> statement-breakpoint
ALTER TABLE `ai_conversations` ADD `provider_context` text;--> statement-breakpoint
ALTER TABLE `ai_conversations` ADD `approved_at` text;--> statement-breakpoint
ALTER TABLE `ai_conversations` ADD `provider_started_at` text;--> statement-breakpoint
CREATE INDEX `ai_conversations_provider_started` ON `ai_conversations` (`provider_started_at`);