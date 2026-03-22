import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const payPeriodsTable = pgTable("pay_periods", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  status: text("status").notNull().default("draft"),
  totalPayroll: numeric("total_payroll", { precision: 12, scale: 2 }),
  totalSubcontractors: numeric("total_subcontractors", { precision: 12, scale: 2 }),
  totalGrand: numeric("total_grand", { precision: 12, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const timeEntriesTable = pgTable("time_entries", {
  id: serial("id").primaryKey(),
  periodId: integer("period_id").notNull().references(() => payPeriodsTable.id, { onDelete: "cascade" }),
  workerId: integer("worker_id").notNull(),
  hotelId: integer("hotel_id"),
  workerName: text("worker_name").notNull(),
  hotelName: text("hotel_name"),
  entryType: text("entry_type").notNull().default("payroll"),
  hoursWorked: numeric("hours_worked", { precision: 8, scale: 2 }),
  ratePerHour: numeric("rate_per_hour", { precision: 8, scale: 2 }),
  flatAmount: numeric("flat_amount", { precision: 10, scale: 2 }),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  paymentStatus: text("payment_status").notNull().default("pending"),
  paymentMethod: text("payment_method"),
  interacEmail: text("interac_email"),
  notes: text("notes"),
  region: text("region"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  periodId: integer("period_id").notNull().references(() => payPeriodsTable.id, { onDelete: "cascade" }),
  workerId: integer("worker_id").notNull(),
  workerName: text("worker_name").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: text("payment_method").notNull(),
  interacEmail: text("interac_email"),
  chequeNumber: text("cheque_number"),
  status: text("status").notNull().default("pending"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPayPeriodSchema = createInsertSchema(payPeriodsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayPeriod = z.infer<typeof insertPayPeriodSchema>;
export type PayPeriod = typeof payPeriodsTable.$inferSelect;

export const insertTimeEntrySchema = createInsertSchema(timeEntriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;
export type TimeEntry = typeof timeEntriesTable.$inferSelect;

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
