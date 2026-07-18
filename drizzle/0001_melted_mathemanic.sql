CREATE TABLE `venue_placements` (
	`venue_name` text PRIMARY KEY NOT NULL,
	`longitude` real NOT NULL,
	`latitude` real NOT NULL,
	`placed_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
