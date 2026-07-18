CREATE TABLE `venue_location_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`venue_name` text NOT NULL,
	`current_longitude` real NOT NULL,
	`current_latitude` real NOT NULL,
	`proposed_longitude` real NOT NULL,
	`proposed_latitude` real NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reported_by` text NOT NULL,
	`reviewed_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`reviewed_at` text
);
--> statement-breakpoint
CREATE INDEX `venue_location_reports_status_idx` ON `venue_location_reports` (`status`);--> statement-breakpoint
CREATE INDEX `venue_location_reports_venue_idx` ON `venue_location_reports` (`venue_name`);