CREATE TABLE `crew_items` (
	`id` text PRIMARY KEY NOT NULL,
	`crew_id` text NOT NULL,
	`kind` text NOT NULL,
	`reference_id` text NOT NULL,
	`title` text NOT NULL,
	`meta` text DEFAULT '' NOT NULL,
	`starts_at` text,
	`visited` integer DEFAULT false NOT NULL,
	`visited_by` text,
	`visited_at` text,
	`added_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`crew_id`) REFERENCES `crews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crew_items_reference_idx` ON `crew_items` (`crew_id`,`kind`,`reference_id`);--> statement-breakpoint
CREATE INDEX `crew_items_crew_idx` ON `crew_items` (`crew_id`);--> statement-breakpoint
CREATE TABLE `crew_members` (
	`crew_id` text NOT NULL,
	`user_email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`joined_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`crew_id`, `user_email`),
	FOREIGN KEY (`crew_id`) REFERENCES `crews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `crew_members_user_idx` ON `crew_members` (`user_email`);--> statement-breakpoint
CREATE TABLE `crews` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`invite_code` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crews_invite_code_idx` ON `crews` (`invite_code`);