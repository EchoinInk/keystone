CREATE TABLE `acquisition_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`priority` text DEFAULT 'Medium' NOT NULL,
	`profile_status` text DEFAULT 'Not started' NOT NULL,
	`profile_url` text DEFAULT '' NOT NULL,
	`target_services` text DEFAULT '' NOT NULL,
	`target_client_type` text DEFAULT '' NOT NULL,
	`frequency` text DEFAULT '' NOT NULL,
	`leads_generated` integer DEFAULT 0 NOT NULL,
	`conversion_rate` real DEFAULT 0 NOT NULL,
	`revenue_generated` real DEFAULT 0 NOT NULL,
	`last_activity` text,
	`next_action` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `launch_objectives` (
	`id` text PRIMARY KEY NOT NULL,
	`phase_id` text,
	`week_number` integer,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT 'High' NOT NULL,
	`due_date` text,
	`dependency` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Todo' NOT NULL,
	`task_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `launch_phases` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phase_number` integer DEFAULT 1 NOT NULL,
	`focus` text DEFAULT '' NOT NULL,
	`target_date` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'Not started' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `marketing_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`platform_id` text,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`target_audience` text DEFAULT '' NOT NULL,
	`service_id` text,
	`status` text DEFAULT 'Template' NOT NULL,
	`date_posted` text,
	`link` text DEFAULT '' NOT NULL,
	`responses` integer DEFAULT 0 NOT NULL,
	`leads_generated` integer DEFAULT 0 NOT NULL,
	`follow_up_date` text,
	`performance_notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outreach_records` (
	`id` text PRIMARY KEY NOT NULL,
	`business` text NOT NULL,
	`contact_person` text DEFAULT '' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`problem_observed` text DEFAULT '' NOT NULL,
	`opportunity` text DEFAULT '' NOT NULL,
	`service_id` text,
	`channel_id` text,
	`date_contacted` text,
	`message` text DEFAULT '' NOT NULL,
	`response` text DEFAULT '' NOT NULL,
	`follow_up_date` text,
	`outcome` text DEFAULT 'Planned' NOT NULL,
	`lead_id` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `portfolio_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`capability` text DEFAULT '' NOT NULL,
	`technologies` text DEFAULT '' NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`repository_id` text,
	`live_url` text DEFAULT '' NOT NULL,
	`readiness` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'Planning' NOT NULL,
	`next_action` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `professional_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`professional_title` text DEFAULT '' NOT NULL,
	`positioning_statement` text DEFAULT '' NOT NULL,
	`value_proposition` text DEFAULT '' NOT NULL,
	`short_bio` text DEFAULT '' NOT NULL,
	`extended_bio` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`portfolio_project_id` text,
	`display_order` integer DEFAULT 0 NOT NULL,
	`readiness` integer DEFAULT 0 NOT NULL,
	`readme_status` text DEFAULT 'Missing' NOT NULL,
	`screenshot_status` text DEFAULT 'Missing' NOT NULL,
	`demo_status` text DEFAULT 'Missing' NOT NULL,
	`build_status` text DEFAULT 'Unknown' NOT NULL,
	`last_updated` text,
	`replacement_candidate` text DEFAULT '' NOT NULL,
	`quality_notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `resume_achievements` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`outcome` text DEFAULT '' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`project_id` text,
	`technologies` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'Engineering' NOT NULL,
	`proficiency` text DEFAULT 'Working' NOT NULL,
	`service_ids` text DEFAULT '' NOT NULL,
	`portfolio_project_ids` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Active' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `testimonials` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`client_id` text,
	`quote` text DEFAULT '' NOT NULL,
	`author` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Requested' NOT NULL,
	`requested_at` text,
	`received_at` text,
	`permission` text DEFAULT 'Pending' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `leads` ADD `source` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `project_type` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `project_description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `project_state` text DEFAULT 'New project' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `desired_outcome` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `required_services` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `technology_stack` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `budget_range` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `preferred_timeline` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `decision_maker` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `urgency` text DEFAULT 'Medium' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `links` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `follow_up_date` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `qualification_score` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `category` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `ideal_client` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `deliverables` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `technologies` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `project_size` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `pricing_model` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `typical_timeline` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `related_projects` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `lead_channels` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `services` ADD `notes` text DEFAULT '' NOT NULL;
