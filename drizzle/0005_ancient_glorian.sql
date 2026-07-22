ALTER TABLE `tasks` ADD `sprint_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `objective_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `assignee` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `notes` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `previous_status` text DEFAULT 'To do' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `completed_at` text;
