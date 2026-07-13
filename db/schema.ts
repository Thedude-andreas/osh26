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
