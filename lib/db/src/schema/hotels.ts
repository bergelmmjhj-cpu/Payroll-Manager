import { pgTable, text, serial, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const hotelsTable = pgTable("hotels", {
  id: serial("id").primaryKey(),
  renderDbId: text("render_db_id"),
  externalId: text("external_id").unique(),
  name: text("name").notNull(),
  address: text("address"),
  city: text("city"),
  province: text("province"),
  region: text("region"),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  hiringStatus: text("hiring_status").notNull().default("open"),
  payRate: text("pay_rate").notNull().default(""),
  jobPosition: text("job_position").notNull().default(""),
  positions: jsonb("positions").notNull().default("[]"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertHotelSchema = createInsertSchema(hotelsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHotel = z.infer<typeof insertHotelSchema>;
export type Hotel = typeof hotelsTable.$inferSelect;
