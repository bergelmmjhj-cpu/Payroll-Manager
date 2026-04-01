import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workersTable } from "./workers";
import { hotelsTable } from "./hotels";
import { authUsersTable } from "./auth";
import { timeEntriesTable } from "./payPeriods";

export const shiftLogsTable = pgTable(
  "shift_logs",
  {
    id:                     serial("id").primaryKey(),
    workerId:               integer("worker_id").notNull().references(() => workersTable.id),
    hotelId:                integer("hotel_id").notNull().references(() => hotelsTable.id),
    clockInAt:              timestamp("clock_in_at", { withTimezone: true }),
    clockOutAt:             timestamp("clock_out_at", { withTimezone: true }),
    clockInLatitude:        numeric("clock_in_latitude", { precision: 10, scale: 7 }),
    clockInLongitude:       numeric("clock_in_longitude", { precision: 10, scale: 7 }),
    clockOutLatitude:       numeric("clock_out_latitude", { precision: 10, scale: 7 }),
    clockOutLongitude:      numeric("clock_out_longitude", { precision: 10, scale: 7 }),
    clockInDistanceMeters:  numeric("clock_in_distance_meters", { precision: 8, scale: 2 }),
    clockOutDistanceMeters: numeric("clock_out_distance_meters", { precision: 8, scale: 2 }),
    status:                 text("status").notNull().default("open"),
    submittedAt:            timestamp("submitted_at", { withTimezone: true }),
    notes:                  text("notes"),
    timeEntryId:            integer("time_entry_id").references(() => timeEntriesTable.id),
    createdAt:              timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:              timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("idx_shift_logs_worker").on(t.workerId),
    index("idx_shift_logs_hotel").on(t.hotelId),
    index("idx_shift_logs_status").on(t.status),
  ],
);

export const shiftApprovalsTable = pgTable("shift_approvals", {
  id:                   serial("id").primaryKey(),
  shiftLogId:           integer("shift_log_id").notNull().references(() => shiftLogsTable.id),
  approverAuthUserId:   integer("approver_auth_user_id").references(() => authUsersTable.id),
  approverName:         text("approver_name").notNull(),
  approverEmail:        text("approver_email"),
  approvalStatus:       text("approval_status").notNull(),
  confirmedByCheckbox:  boolean("confirmed_by_checkbox").notNull().default(false),
  signatureData:        text("signature_data"),
  notes:                text("notes"),
  ipAddress:            text("ip_address"),
  approvedAt:           timestamp("approved_at", { withTimezone: true }).notNull(),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const correctionRequestsTable = pgTable("correction_requests", {
  id:                     serial("id").primaryKey(),
  shiftLogId:             integer("shift_log_id").notNull().references(() => shiftLogsTable.id),
  requestedByWorkerId:    integer("requested_by_worker_id").notNull().references(() => workersTable.id),
  originalClockIn:        timestamp("original_clock_in", { withTimezone: true }),
  originalClockOut:       timestamp("original_clock_out", { withTimezone: true }),
  requestedClockIn:       timestamp("requested_clock_in", { withTimezone: true }),
  requestedClockOut:      timestamp("requested_clock_out", { withTimezone: true }),
  reason:                 text("reason").notNull(),
  status:                 text("status").notNull().default("pending"),
  reviewedByAuthUserId:   integer("reviewed_by_auth_user_id").references(() => authUsersTable.id),
  reviewNotes:            text("review_notes"),
  reviewedAt:             timestamp("reviewed_at", { withTimezone: true }),
  createdAt:              timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:              timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const shiftGeofenceEventsTable = pgTable(
  "shift_geofence_events",
  {
    id:             serial("id").primaryKey(),
    workerId:       integer("worker_id").notNull().references(() => workersTable.id),
    hotelId:        integer("hotel_id").notNull().references(() => hotelsTable.id),
    action:         text("action").notNull(),
    eventResult:    text("event_result").notNull(),
    latitude:       numeric("latitude", { precision: 10, scale: 7 }),
    longitude:      numeric("longitude", { precision: 10, scale: 7 }),
    distanceMeters: numeric("distance_meters", { precision: 8, scale: 2 }),
    message:        text("message"),
    createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_shift_geofence_events_worker").on(t.workerId),
    index("idx_shift_geofence_events_hotel").on(t.hotelId),
    index("idx_shift_geofence_events_action").on(t.action),
  ],
);

export type ShiftLog          = typeof shiftLogsTable.$inferSelect;
export type ShiftApproval     = typeof shiftApprovalsTable.$inferSelect;
export type CorrectionRequest = typeof correctionRequestsTable.$inferSelect;
export type ShiftGeofenceEvent = typeof shiftGeofenceEventsTable.$inferSelect;

export const insertShiftLogSchema = createInsertSchema(shiftLogsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertShiftApprovalSchema = createInsertSchema(shiftApprovalsTable).omit({
  id: true,
  createdAt: true,
});
export const insertCorrectionRequestSchema = createInsertSchema(correctionRequestsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertShiftGeofenceEventSchema = createInsertSchema(shiftGeofenceEventsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertShiftLog          = z.infer<typeof insertShiftLogSchema>;
export type InsertShiftApproval     = z.infer<typeof insertShiftApprovalSchema>;
export type InsertCorrectionRequest = z.infer<typeof insertCorrectionRequestSchema>;
export type InsertShiftGeofenceEvent = z.infer<typeof insertShiftGeofenceEventSchema>;
