ALTER TABLE `professional_profiles` ADD `location` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `professional_profiles` ADD `availability` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `professional_profiles` ADD `core_positioning` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `professional_profiles` ADD `contact_cta` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `repositories` ADD `github_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `repositories` ADD `live_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `repositories` ADD `pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `repositories` ADD `portfolio_ready` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `repositories` ADD `installation_status` text DEFAULT 'Missing' NOT NULL;--> statement-breakpoint
ALTER TABLE `repositories` ADD `feature_docs_status` text DEFAULT 'Missing' NOT NULL;--> statement-breakpoint
ALTER TABLE `repositories` ADD `technologies` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `repositories` ADD `problem_solved` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `repositories` ADD `licence` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `repositories` ADD `issues_remaining` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `short_description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `related_skills` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `portfolio_visible` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `call_to_action` text DEFAULT 'Start a conversation' NOT NULL;--> statement-breakpoint
ALTER TABLE `skills` ADD `evidence` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `skills` ADD `portfolio_visible` integer DEFAULT true NOT NULL;