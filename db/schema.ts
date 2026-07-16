import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const crews = sqliteTable("crews", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  inviteCode: text("invite_code").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("crews_invite_code_idx").on(table.inviteCode)]);

export const crewMembers = sqliteTable("crew_members", {
  crewId: text("crew_id").notNull().references(() => crews.id, { onDelete: "cascade" }),
  userEmail: text("user_email").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["owner", "member"] }).notNull().default("member"),
  joinedAt: text("joined_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.crewId, table.userEmail] }),
  index("crew_members_user_idx").on(table.userEmail),
]);

export const crewItems = sqliteTable("crew_items", {
  id: text("id").primaryKey(),
  crewId: text("crew_id").notNull().references(() => crews.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["exhibitor", "event"] }).notNull(),
  referenceId: text("reference_id").notNull(),
  title: text("title").notNull(),
  meta: text("meta").notNull().default(""),
  startsAt: text("starts_at"),
  visited: integer("visited", { mode: "boolean" }).notNull().default(false),
  visitedBy: text("visited_by"),
  visitedAt: text("visited_at"),
  addedBy: text("added_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("crew_items_reference_idx").on(table.crewId, table.kind, table.referenceId),
  index("crew_items_crew_idx").on(table.crewId),
]);

export const venuePlacements = sqliteTable("venue_placements", {
  venueName: text("venue_name").primaryKey(),
  longitude: real("longitude").notNull(),
  latitude: real("latitude").notNull(),
  placedBy: text("placed_by").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const venueLocationReports = sqliteTable("venue_location_reports", {
  id: text("id").primaryKey(),
  venueName: text("venue_name").notNull(),
  currentLongitude: real("current_longitude").notNull(),
  currentLatitude: real("current_latitude").notNull(),
  proposedLongitude: real("proposed_longitude").notNull(),
  proposedLatitude: real("proposed_latitude").notNull(),
  note: text("note").notNull().default(""),
  status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  reportedBy: text("reported_by").notNull(),
  reviewedBy: text("reviewed_by"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  reviewedAt: text("reviewed_at"),
}, (table) => [
  index("venue_location_reports_status_idx").on(table.status),
  index("venue_location_reports_venue_idx").on(table.venueName),
]);

export const locationPreferences = sqliteTable("location_preferences", {
  userEmail: text("user_email").primaryKey(),
  mode: text("mode", { enum: ["off", "request", "tracking"] }).notNull().default("off"),
  basemap: text("basemap", { enum: ["osm", "ortho"] }).notNull().default("osm"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const locationRequests = sqliteTable("location_requests", {
  id: text("id").primaryKey(),
  crewId: text("crew_id").notNull().references(() => crews.id, { onDelete: "cascade" }),
  requestedBy: text("requested_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("location_requests_crew_time_idx").on(table.crewId, table.createdAt)]);

export const locationSamples = sqliteTable("location_samples", {
  id: text("id").primaryKey(),
  crewId: text("crew_id").notNull().references(() => crews.id, { onDelete: "cascade" }),
  userEmail: text("user_email").notNull(),
  kind: text("kind", { enum: ["request", "tracking"] }).notNull(),
  requestId: text("request_id"),
  longitude: real("longitude").notNull(),
  latitude: real("latitude").notNull(),
  accuracy: real("accuracy").notNull(),
  capturedAt: text("captured_at").notNull(),
}, (table) => [
  index("location_samples_crew_time_idx").on(table.crewId, table.capturedAt),
  index("location_samples_user_time_idx").on(table.userEmail, table.capturedAt),
]);
