CREATE TABLE `location_preferences` (
	`user_email` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'off' NOT NULL,
	`basemap` text DEFAULT 'osm' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `location_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`crew_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`crew_id`) REFERENCES `crews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `location_requests_crew_time_idx` ON `location_requests` (`crew_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `location_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`crew_id` text NOT NULL,
	`user_email` text NOT NULL,
	`kind` text NOT NULL,
	`request_id` text,
	`longitude` real NOT NULL,
	`latitude` real NOT NULL,
	`accuracy` real NOT NULL,
	`captured_at` text NOT NULL,
	FOREIGN KEY (`crew_id`) REFERENCES `crews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `location_samples_crew_time_idx` ON `location_samples` (`crew_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `location_samples_user_time_idx` ON `location_samples` (`user_email`,`captured_at`);