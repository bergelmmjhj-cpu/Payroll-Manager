import { index, integer, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workersTable } from "./workers";
import { hotelsTable } from "./hotels";

export const workerHotelRatesTable = pgTable(
  "worker_hotel_rates",
  {
    id: serial("id").primaryKey(),
    workerId: integer("worker_id").notNull().references(() => workersTable.id, { onDelete: "cascade" }),
    hotelId: integer("hotel_id").notNull().references(() => hotelsTable.id, { onDelete: "cascade" }),
    role: text("role"),
    rate: numeric("rate", { precision: 8, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("IDX_worker_hotel_rates_worker_hotel").on(table.workerId, table.hotelId),
    index("IDX_worker_hotel_rates_role").on(table.role),
  ],
);

export const insertWorkerHotelRateSchema = createInsertSchema(workerHotelRatesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertWorkerHotelRate = z.infer<typeof insertWorkerHotelRateSchema>;
export type WorkerHotelRate = typeof workerHotelRatesTable.$inferSelect;