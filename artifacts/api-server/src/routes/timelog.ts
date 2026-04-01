import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  db,
  workersTable,
  hotelsTable,
  workerHotelRatesTable,
  shiftLogsTable,
  shiftApprovalsTable,
  correctionRequestsTable,
  shiftGeofenceEventsTable,
  timeEntriesTable,
} from "@workspace/db";
import { eq, and, ne, desc } from "drizzle-orm";

type GeofenceResult = "allowed" | "blocked" | "missing_location" | "missing_hotel_coords" | "not_found";

const router: IRouter = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseId(raw: unknown): number {
  return parseInt(String(raw), 10);
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

function requireWorker(req: Request, res: Response, next: NextFunction): void {
  const u = req.user as any;
  if (!u?.workerId) {
    res.status(403).json({ error: "Worker account required. Ask your administrator to link your account." });
    return;
  }
  next();
}

function requireApproverOrAdmin(req: Request, res: Response, next: NextFunction): void {
  const u = req.user as any;
  if (!u?.isAdmin && u?.role !== "approver") {
    res.status(403).json({ error: "Approver or admin access required" });
    return;
  }
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const u = req.user as any;
  if (!u?.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

async function logGeofenceEvent(params: {
  workerId: number;
  hotelId: number;
  action: "clock_in" | "clock_out";
  result: GeofenceResult;
  latitude?: number | null;
  longitude?: number | null;
  distanceMeters?: number | null;
  message?: string;
}): Promise<void> {
  await db.insert(shiftGeofenceEventsTable).values({
    workerId: params.workerId,
    hotelId: params.hotelId,
    action: params.action,
    eventResult: params.result,
    latitude: params.latitude != null ? String(params.latitude) : null,
    longitude: params.longitude != null ? String(params.longitude) : null,
    distanceMeters: params.distanceMeters != null ? String(Math.round(params.distanceMeters)) : null,
    message: params.message ?? null,
  });
}

// ─── Worker: Clock In ────────────────────────────────────────────────────────

router.post("/timelog/clock-in", requireAuth, requireWorker, async (req: Request, res: Response): Promise<void> => {
  const u = req.user as any;
  const { hotelId, latitude, longitude } = req.body;

  if (!hotelId) {
    res.status(400).json({ error: "hotelId is required" });
    return;
  }
  if (latitude == null || longitude == null) {
    await logGeofenceEvent({
      workerId: u.workerId,
      hotelId: parseId(hotelId),
      action: "clock_in",
      result: "missing_location",
      message: "GPS location missing on clock-in request",
    });
    res.status(400).json({ error: "GPS location is required to clock in. Please enable location access and try again." });
    return;
  }

  const [hotel] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, parseId(hotelId))).limit(1);
  if (!hotel) {
    await logGeofenceEvent({
      workerId: u.workerId,
      hotelId: parseId(hotelId),
      action: "clock_in",
      result: "not_found",
      latitude: Number(latitude),
      longitude: Number(longitude),
      message: "Hotel not found during clock-in geofence validation",
    });
    res.status(404).json({ error: "Hotel not found" });
    return;
  }

  if (hotel.latitude == null || hotel.longitude == null) {
    await logGeofenceEvent({
      workerId: u.workerId,
      hotelId: hotel.id,
      action: "clock_in",
      result: "missing_hotel_coords",
      latitude: Number(latitude),
      longitude: Number(longitude),
      message: "Workplace has no configured coordinates",
    });
    res.status(422).json({ error: "This workplace has no GPS coordinates configured. Contact your administrator." });
    return;
  }

  const distance = haversineMeters(
    Number(hotel.latitude), Number(hotel.longitude),
    Number(latitude), Number(longitude),
  );
  const allowed = hotel.geofenceRadiusMeters ?? 200;

  if (distance > allowed) {
    await logGeofenceEvent({
      workerId: u.workerId,
      hotelId: hotel.id,
      action: "clock_in",
      result: "blocked",
      latitude: Number(latitude),
      longitude: Number(longitude),
      distanceMeters: distance,
      message: `Outside geofence (${Math.round(distance)}m > ${allowed}m)`,
    });
    res.status(403).json({
      error: `You are ${Math.round(distance)} m from ${hotel.name}. You must be within ${allowed} m to clock in.`,
      distanceMeters: Math.round(distance),
      allowedRadiusMeters: allowed,
    });
    return;
  }

  // Block if already has an open shift
  const [existingOpen] = await db
    .select({ id: shiftLogsTable.id })
    .from(shiftLogsTable)
    .where(and(eq(shiftLogsTable.workerId, u.workerId), eq(shiftLogsTable.status, "open")))
    .limit(1);

  if (existingOpen) {
    res.status(409).json({ error: "You already have an open shift. Clock out first." });
    return;
  }

  const [log] = await db
    .insert(shiftLogsTable)
    .values({
      workerId: u.workerId,
      hotelId: parseId(hotelId),
      clockInAt: new Date(),
      clockInLatitude: String(latitude),
      clockInLongitude: String(longitude),
      clockInDistanceMeters: String(Math.round(distance)),
      status: "open",
    })
    .returning();

  await logGeofenceEvent({
    workerId: u.workerId,
    hotelId: hotel.id,
    action: "clock_in",
    result: "allowed",
    latitude: Number(latitude),
    longitude: Number(longitude),
    distanceMeters: distance,
    message: "Clock-in geofence check passed",
  });

  res.status(201).json(log);
});

// ─── Worker: Clock Out ───────────────────────────────────────────────────────

router.post("/timelog/clock-out", requireAuth, requireWorker, async (req: Request, res: Response): Promise<void> => {
  const u = req.user as any;
  const { latitude, longitude } = req.body;

  if (latitude == null || longitude == null) {
    res.status(400).json({ error: "GPS location is required to clock out." });
    return;
  }

  const [openShift] = await db
    .select()
    .from(shiftLogsTable)
    .where(and(eq(shiftLogsTable.workerId, u.workerId), eq(shiftLogsTable.status, "open")))
    .limit(1);

  if (!openShift) {
    res.status(404).json({ error: "No open shift found." });
    return;
  }

  const [hotel] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, openShift.hotelId)).limit(1);
  if (!hotel) {
    res.status(500).json({ error: "Hotel not found for this shift." });
    return;
  }

  let distanceMeters: number | null = null;
  if (hotel.latitude != null && hotel.longitude != null) {
    distanceMeters = Math.round(
      haversineMeters(Number(hotel.latitude), Number(hotel.longitude), Number(latitude), Number(longitude)),
    );
    const allowed = hotel.geofenceRadiusMeters ?? 200;
    if (distanceMeters > allowed) {
      await logGeofenceEvent({
        workerId: u.workerId,
        hotelId: hotel.id,
        action: "clock_out",
        result: "blocked",
        latitude: Number(latitude),
        longitude: Number(longitude),
        distanceMeters,
        message: `Outside geofence (${distanceMeters}m > ${allowed}m)`,
      });
      res.status(403).json({
        error: `You are ${distanceMeters} m from ${hotel.name}. You must be within ${allowed} m to clock out.`,
        distanceMeters,
        allowedRadiusMeters: allowed,
      });
      return;
    }
  } else {
    await logGeofenceEvent({
      workerId: u.workerId,
      hotelId: hotel.id,
      action: "clock_out",
      result: "missing_hotel_coords",
      latitude: Number(latitude),
      longitude: Number(longitude),
      message: "Workplace has no configured coordinates on clock-out",
    });
    res.status(422).json({ error: "This workplace has no GPS coordinates configured. Contact your administrator." });
    return;
  }

  const [updated] = await db
    .update(shiftLogsTable)
    .set({
      clockOutAt: new Date(),
      clockOutLatitude: String(latitude),
      clockOutLongitude: String(longitude),
      clockOutDistanceMeters: distanceMeters != null ? String(distanceMeters) : null,
    })
    .where(eq(shiftLogsTable.id, openShift.id))
    .returning();

  await logGeofenceEvent({
    workerId: u.workerId,
    hotelId: hotel.id,
    action: "clock_out",
    result: "allowed",
    latitude: Number(latitude),
    longitude: Number(longitude),
    distanceMeters,
    message: "Clock-out geofence check passed",
  });

  res.json(updated);
});

// ─── Worker: Active shift ────────────────────────────────────────────────────

router.get("/timelog/active", requireAuth, requireWorker, async (req: Request, res: Response): Promise<void> => {
  const u = req.user as any;
  const [open] = await db
    .select()
    .from(shiftLogsTable)
    .where(and(eq(shiftLogsTable.workerId, u.workerId), eq(shiftLogsTable.status, "open")))
    .limit(1);
  res.json(open ?? null);
});

// ─── Worker: Own history ─────────────────────────────────────────────────────

router.get("/timelog/my-logs", requireAuth, requireWorker, async (req: Request, res: Response): Promise<void> => {
  const u = req.user as any;
  const logs = await db
    .select()
    .from(shiftLogsTable)
    .where(eq(shiftLogsTable.workerId, u.workerId))
    .orderBy(desc(shiftLogsTable.clockInAt));
  res.json(logs);
});

// ─── Worker: Submit for approval ─────────────────────────────────────────────

router.post("/timelog/:id/submit", requireAuth, requireWorker, async (req: Request, res: Response): Promise<void> => {
  const u = req.user as any;
  const id = parseId(req.params.id);

  const [log] = await db.select().from(shiftLogsTable).where(eq(shiftLogsTable.id, id)).limit(1);
  if (!log) { res.status(404).json({ error: "Shift not found" }); return; }
  if (log.workerId !== u.workerId) { res.status(403).json({ error: "Not your shift" }); return; }
  if (!log.clockOutAt) { res.status(400).json({ error: "Clock out first before submitting" }); return; }
  if (log.status !== "open") { res.status(400).json({ error: `Shift is already '${log.status}'` }); return; }

  const [updated] = await db
    .update(shiftLogsTable)
    .set({ status: "pending_approval", submittedAt: new Date() })
    .where(eq(shiftLogsTable.id, id))
    .returning();

  res.json(updated);
});

// ─── Worker: Correction request ───────────────────────────────────────────────

router.post("/timelog/:id/correction", requireAuth, requireWorker, async (req: Request, res: Response): Promise<void> => {
  const u = req.user as any;
  const id = parseId(req.params.id);
  const { requestedClockIn, requestedClockOut, reason } = req.body;

  if (!reason) { res.status(400).json({ error: "reason is required" }); return; }

  const [log] = await db.select().from(shiftLogsTable).where(eq(shiftLogsTable.id, id)).limit(1);
  if (!log) { res.status(404).json({ error: "Shift not found" }); return; }
  if (log.workerId !== u.workerId) { res.status(403).json({ error: "Not your shift" }); return; }
  if (log.status === "open") { res.status(400).json({ error: "Submit the shift first before requesting a correction" }); return; }

  const [request] = await db
    .insert(correctionRequestsTable)
    .values({
      shiftLogId: id,
      requestedByWorkerId: u.workerId,
      originalClockIn: log.clockInAt,
      originalClockOut: log.clockOutAt,
      requestedClockIn: requestedClockIn ? new Date(requestedClockIn) : null,
      requestedClockOut: requestedClockOut ? new Date(requestedClockOut) : null,
      reason,
      status: "pending",
    })
    .returning();

  await db.update(shiftLogsTable).set({ status: "correction_requested" }).where(eq(shiftLogsTable.id, id));

  res.status(201).json(request);
});

// ─── Worker: Own correction requests ─────────────────────────────────────────

router.get("/timelog/my-corrections", requireAuth, requireWorker, async (req: Request, res: Response): Promise<void> => {
  const u = req.user as any;
  const corrections = await db
    .select()
    .from(correctionRequestsTable)
    .where(eq(correctionRequestsTable.requestedByWorkerId, u.workerId))
    .orderBy(desc(correctionRequestsTable.createdAt));
  res.json(corrections);
});

// ─── Approver: Pending list ───────────────────────────────────────────────────

router.get(
  "/timelog/pending-approvals",
  requireAuth,
  requireApproverOrAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const logs = await db
      .select()
      .from(shiftLogsTable)
      .where(eq(shiftLogsTable.status, "pending_approval"))
      .orderBy(shiftLogsTable.submittedAt);
    res.json(logs);
  },
);

// ─── Approver: Approve ────────────────────────────────────────────────────────

router.post(
  "/timelog/:id/approve",
  requireAuth,
  requireApproverOrAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const u = req.user as any;
    const id = parseId(req.params.id);
    const { approverName, approverEmail, notes, confirmedByCheckbox, signatureData } = req.body;

    if (!approverName) { res.status(400).json({ error: "approverName is required" }); return; }
    if (!confirmedByCheckbox) { res.status(400).json({ error: "Confirmation checkbox must be checked" }); return; }

    const [log] = await db.select().from(shiftLogsTable).where(eq(shiftLogsTable.id, id)).limit(1);
    if (!log) { res.status(404).json({ error: "Shift not found" }); return; }
    if (log.status !== "pending_approval") {
      res.status(400).json({ error: `Shift status is '${log.status}', expected 'pending_approval'` });
      return;
    }

    // Self-approval guard
    if (u.workerId && u.workerId === log.workerId) {
      res.status(403).json({ error: "You cannot approve your own shift" });
      return;
    }

    const [approval] = await db
      .insert(shiftApprovalsTable)
      .values({
        shiftLogId: id,
        approverAuthUserId: u.id ?? null,
        approverName,
        approverEmail: approverEmail ?? null,
        approvalStatus: "approved",
        confirmedByCheckbox: Boolean(confirmedByCheckbox),
        signatureData: signatureData ?? null,
        notes: notes ?? null,
        ipAddress: req.ip ?? null,
        approvedAt: new Date(),
      })
      .returning();

    await db.update(shiftLogsTable).set({ status: "approved" }).where(eq(shiftLogsTable.id, id));

    res.json(approval);
  },
);

// ─── Approver: Reject ─────────────────────────────────────────────────────────

router.post(
  "/timelog/:id/reject",
  requireAuth,
  requireApproverOrAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const u = req.user as any;
    const id = parseId(req.params.id);
    const { approverName, notes } = req.body;

    if (!approverName) { res.status(400).json({ error: "approverName is required" }); return; }

    const [log] = await db.select().from(shiftLogsTable).where(eq(shiftLogsTable.id, id)).limit(1);
    if (!log) { res.status(404).json({ error: "Shift not found" }); return; }

    if (u.workerId && u.workerId === log.workerId) {
      res.status(403).json({ error: "You cannot reject your own shift" });
      return;
    }

    await db.insert(shiftApprovalsTable).values({
      shiftLogId: id,
      approverAuthUserId: u.id ?? null,
      approverName,
      approvalStatus: "rejected",
      confirmedByCheckbox: false,
      notes: notes ?? null,
      ipAddress: req.ip ?? null,
      approvedAt: new Date(),
    });

    await db.update(shiftLogsTable).set({ status: "rejected" }).where(eq(shiftLogsTable.id, id));

    res.json({ message: "Shift rejected" });
  },
);

// ─── Admin: Pending correction requests ──────────────────────────────────────

router.get(
  "/timelog/corrections",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const requests = await db
      .select()
      .from(correctionRequestsTable)
      .where(eq(correctionRequestsTable.status, "pending"))
      .orderBy(correctionRequestsTable.createdAt);
    res.json(requests);
  },
);

router.post(
  "/timelog/corrections/:id/approve",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const u = req.user as any;
    const id = parseId(req.params.id);
    const { reviewNotes } = req.body;

    const [cr] = await db
      .select()
      .from(correctionRequestsTable)
      .where(eq(correctionRequestsTable.id, id))
      .limit(1);
    if (!cr) { res.status(404).json({ error: "Correction request not found" }); return; }
    if (cr.status !== "pending") { res.status(400).json({ error: "Not in pending status" }); return; }

    // Apply corrected times to shift_log (originals preserved in correction_requests row)
    await db
      .update(shiftLogsTable)
      .set({
        clockInAt: cr.requestedClockIn ?? undefined,
        clockOutAt: cr.requestedClockOut ?? undefined,
        status: "approved",
      })
      .where(eq(shiftLogsTable.id, cr.shiftLogId));

    const [updated] = await db
      .update(correctionRequestsTable)
      .set({
        status: "approved",
        reviewedByAuthUserId: u.id,
        reviewNotes: reviewNotes ?? null,
        reviewedAt: new Date(),
      })
      .where(eq(correctionRequestsTable.id, id))
      .returning();

    res.json(updated);
  },
);

router.post(
  "/timelog/corrections/:id/reject",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const u = req.user as any;
    const id = parseId(req.params.id);
    const { reviewNotes } = req.body;

    const [cr] = await db
      .select()
      .from(correctionRequestsTable)
      .where(eq(correctionRequestsTable.id, id))
      .limit(1);
    if (!cr) { res.status(404).json({ error: "Correction request not found" }); return; }

    await db
      .update(shiftLogsTable)
      .set({ status: "pending_approval" })
      .where(eq(shiftLogsTable.id, cr.shiftLogId));

    const [updated] = await db
      .update(correctionRequestsTable)
      .set({
        status: "rejected",
        reviewedByAuthUserId: u.id,
        reviewNotes: reviewNotes ?? null,
        reviewedAt: new Date(),
      })
      .where(eq(correctionRequestsTable.id, id))
      .returning();

    res.json(updated);
  },
);

// ─── Admin: Consolidated approved hours ──────────────────────────────────────

router.get(
  "/timelog/admin/consolidated",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const { hotelId, workerId, periodId } = req.query;

    const conditions: ReturnType<typeof eq>[] = [eq(shiftLogsTable.status, "approved")];
    if (hotelId)  conditions.push(eq(shiftLogsTable.hotelId,  parseId(hotelId)));
    if (workerId) conditions.push(eq(shiftLogsTable.workerId, parseId(workerId)));

    const logs = await db
      .select()
      .from(shiftLogsTable)
      .where(and(...conditions))
      .orderBy(shiftLogsTable.clockInAt);

    const enriched = logs.map((log) => {
      const inMs  = log.clockInAt  ? new Date(log.clockInAt).getTime()  : null;
      const outMs = log.clockOutAt ? new Date(log.clockOutAt).getTime() : null;
      const hoursWorked = inMs && outMs ? Math.round(((outMs - inMs) / 3_600_000) * 100) / 100 : null;
      return { ...log, hoursWorked };
    });

    const periodFilter = periodId ? parseId(periodId) : null;
    const promotedEntryIds = enriched
      .filter((x) => x.timeEntryId != null)
      .map((x) => x.timeEntryId as number);

    const entriesById = new Map<number, { periodId: number; totalAmount: number }>();
    if (promotedEntryIds.length > 0) {
      const entries = periodFilter != null
        ? await db
          .select({
            id: timeEntriesTable.id,
            periodId: timeEntriesTable.periodId,
            totalAmount: timeEntriesTable.totalAmount,
          })
          .from(timeEntriesTable)
          .where(eq(timeEntriesTable.periodId, periodFilter))
        : await db
          .select({
            id: timeEntriesTable.id,
            periodId: timeEntriesTable.periodId,
            totalAmount: timeEntriesTable.totalAmount,
          })
          .from(timeEntriesTable);
      for (const entry of entries) {
        entriesById.set(entry.id, { periodId: entry.periodId, totalAmount: Number(entry.totalAmount) });
      }
    }

    type GroupRow = {
      periodId: number | null;
      workerId: number;
      hotelId: number;
      approvedShifts: number;
      totalApprovedHours: number;
      promotedHours: number;
      promotedAmount: number;
      unpromotedHours: number;
    };

    const grouped = new Map<string, GroupRow>();
    for (const row of enriched) {
      const entry = row.timeEntryId ? entriesById.get(row.timeEntryId) : undefined;
      const resolvedPeriodId = entry?.periodId ?? null;
      if (periodFilter != null && resolvedPeriodId !== periodFilter) continue;
      const hours = row.hoursWorked ?? 0;
      const key = `${resolvedPeriodId ?? "none"}:${row.workerId}:${row.hotelId}`;
      const current = grouped.get(key) ?? {
        periodId: resolvedPeriodId,
        workerId: row.workerId,
        hotelId: row.hotelId,
        approvedShifts: 0,
        totalApprovedHours: 0,
        promotedHours: 0,
        promotedAmount: 0,
        unpromotedHours: 0,
      };
      current.approvedShifts += 1;
      current.totalApprovedHours += hours;
      if (entry) {
        current.promotedHours += hours;
        current.promotedAmount += entry.totalAmount;
      } else {
        current.unpromotedHours += hours;
      }
      grouped.set(key, current);
    }

    const summary = [...grouped.values()].map((x) => ({
      ...x,
      totalApprovedHours: Math.round(x.totalApprovedHours * 100) / 100,
      promotedHours: Math.round(x.promotedHours * 100) / 100,
      promotedAmount: Math.round(x.promotedAmount * 100) / 100,
      unpromotedHours: Math.round(x.unpromotedHours * 100) / 100,
    }));

    res.json({
      summary,
      detail: enriched,
    });
  },
);

// ─── Admin: Promote approved shift_log → time_entry ──────────────────────────

router.post(
  "/timelog/:id/promote",
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const id = parseId(req.params.id);
    const { periodId, payPeriodHotelId } = req.body;
    if (!periodId) { res.status(400).json({ error: "periodId is required" }); return; }

    const [log] = await db.select().from(shiftLogsTable).where(eq(shiftLogsTable.id, id)).limit(1);
    if (!log) { res.status(404).json({ error: "Shift not found" }); return; }
    if (log.status !== "approved") { res.status(400).json({ error: "Shift must be approved before promoting" }); return; }
    if (log.timeEntryId) { res.status(409).json({ error: "Already promoted to a time entry" }); return; }
    if (!log.clockInAt || !log.clockOutAt) {
      res.status(400).json({ error: "Shift is missing clock-in or clock-out time" });
      return;
    }

    const [worker] = await db.select().from(workersTable).where(eq(workersTable.id, log.workerId)).limit(1);
    const [hotel]  = await db.select().from(hotelsTable).where(eq(hotelsTable.id, log.hotelId)).limit(1);

    const hoursWorked = (new Date(log.clockOutAt).getTime() - new Date(log.clockInAt).getTime()) / 3_600_000;

    // Resolve pay rate: worker_hotel_rates → workers.defaultRate → 0
    const [rateRow] = await db
      .select()
      .from(workerHotelRatesTable)
      .where(and(eq(workerHotelRatesTable.workerId, log.workerId), eq(workerHotelRatesTable.hotelId, log.hotelId)))
      .limit(1);

    const ratePerHour = rateRow
      ? Number(rateRow.rate)
      : worker?.defaultRate
        ? Number(worker.defaultRate)
        : 0;

    const totalAmount = Math.round(hoursWorked * ratePerHour * 100) / 100;
    const workDate    = new Date(log.clockInAt).toISOString().split("T")[0];

    const [entry] = await db
      .insert(timeEntriesTable)
      .values({
        periodId: parseId(periodId),
        payPeriodHotelId: payPeriodHotelId ? parseId(payPeriodHotelId) : null,
        workerId: log.workerId,
        hotelId:  log.hotelId,
        workerName: worker?.name ?? "Unknown",
        hotelName:  hotel?.name  ?? "Unknown",
        entryType: "payroll",
        workDate,
        hoursWorked: String(Math.round(hoursWorked * 100) / 100),
        totalHours:  String(Math.round(hoursWorked * 100) / 100),
        ratePerHour: String(ratePerHour),
        totalAmount: String(totalAmount),
        paymentStatus: "pending",
        notes: `Promoted from shift log #${log.id}`,
      })
      .returning();

    await db
      .update(shiftLogsTable)
      .set({ timeEntryId: entry.id })
      .where(eq(shiftLogsTable.id, id));

    res.status(201).json(entry);
  },
);

export default router;
