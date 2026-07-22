CREATE TABLE `activity_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`record_id` text,
	`label` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`sprint_id` text,
	`date` text NOT NULL,
	`wins` text DEFAULT '' NOT NULL,
	`challenges` text DEFAULT '' NOT NULL,
	`lessons` text DEFAULT '' NOT NULL,
	`tomorrow_priorities` text DEFAULT '' NOT NULL,
	`ai_summary` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`sprint_id`) REFERENCES `sprints`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`record_id` text NOT NULL,
	`action` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sprint_objectives` (
	`id` text PRIMARY KEY NOT NULL,
	`sprint_id` text NOT NULL,
	`task_id` text,
	`title` text NOT NULL,
	`day_number` integer DEFAULT 1 NOT NULL,
	`milestone` text DEFAULT '' NOT NULL,
	`due_date` text,
	`status` text DEFAULT 'Todo' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`sprint_id`) REFERENCES `sprints`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sprints` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`goal` text DEFAULT '' NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`duration` integer DEFAULT 13 NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`success_metrics` text DEFAULT '' NOT NULL,
	`ai_coaching` text DEFAULT '' NOT NULL,
	`reflection_notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
