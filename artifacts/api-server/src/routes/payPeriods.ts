import { Router, type IRouter } from "express";
import { db, payPeriodsTable, payPeriodHotelsTable, timeEntriesTable, paymentsTable, workersTable, hotelsTable } from "@workspace/db";
import { eq, and, asc, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s, 10);
}

function mapPeriod(p: typeof payPeriodsTable.$inferSelect) {
  return {
    ...p,
    totalPayroll: p.totalPayroll ? Number(p.totalPayroll) : null,
    totalSubcontractors: p.totalSubcontractors ? Number(p.totalSubcontractors) : null,
    totalGrand: p.totalGrand ? Number(p.totalGrand) : null,
  };
}

function mapEntry(e: typeof timeEntriesTable.$inferSelect) {
  return {
    ...e,
    regularHours: e.regularHours ? Number(e.regularHours) : null,
    overtimeHours: e.overtimeHours ? Number(e.overtimeHours) : null,
    otherHours: e.otherHours ? Number(e.otherHours) : null,
    totalHours: e.totalHours ? Number(e.totalHours) : null,
    hoursWorked: e.hoursWorked ? Number(e.hoursWorked) : null,
    ratePerHour: e.ratePerHour ? Number(e.ratePerHour) : null,
    flatAmount: e.flatAmount ? Number(e.flatAmount) : null,
    totalAmount: Number(e.totalAmount),
  };
}

function mapPeriodHotel(h: typeof payPeriodHotelsTable.$inferSelect) {
  return h;
}

async function isPeriodFinalized(periodId: number): Promise<boolean> {
  const [period] = await db
    .select({ status: payPeriodsTable.status })
    .from(payPeriodsTable)
    .where(eq(payPeriodsTable.id, periodId))
    .limit(1);

  return period?.status === "finalized";
}

function mapPayment(p: typeof paymentsTable.$inferSelect) {
  return {
    ...p,
    amount: Number(p.amount),
    paidAt: p.paidAt ? p.paidAt.toISOString() : null,
  };
}

async function recalcPeriodTotals(periodId: number) {
  const payrollTotal = await db
    .select({ total: sql<string>`COALESCE(SUM(total_amount), 0)` })
    .from(timeEntriesTable)
    .where(and(eq(timeEntriesTable.periodId, periodId), eq(timeEntriesTable.entryType, "payroll")));

  const subconTotal = await db
    .select({ total: sql<string>`COALESCE(SUM(total_amount), 0)` })
    .from(timeEntriesTable)
    .where(and(eq(timeEntriesTable.periodId, periodId), eq(timeEntriesTable.entryType, "subcontractor")));

  const totalPayroll = Number(payrollTotal[0]?.total ?? 0);
  const totalSubcontractors = Number(subconTotal[0]?.total ?? 0);
  const totalGrand = totalPayroll + totalSubcontractors;

  await db
    .update(payPeriodsTable)
    .set({
      totalPayroll: totalPayroll.toString(),
      totalSubcontractors: totalSubcontractors.toString(),
      totalGrand: totalGrand.toString(),
    })
    .where(eq(payPeriodsTable.id, periodId));
}

// ─── Pay Periods CRUD ────────────────────────────────────────────────────────

router.get("/pay-periods", async (_req, res): Promise<void> => {
  const periods = await db.select().from(payPeriodsTable).orderBy(desc(payPeriodsTable.createdAt));
  res.json(periods.map(mapPeriod));
});

router.post("/pay-periods", async (req, res): Promise<void> => {
  const { name, startDate, endDate, notes } = req.body;

  if (!name || !startDate || !endDate) {
    res.status(400).json({ error: "name, startDate, endDate are required" });
    return;
  }

  const [period] = await db
    .insert(payPeriodsTable)
    .values({ name, startDate, endDate, notes, status: "draft" })
    .returning();

  res.status(201).json(mapPeriod(period));
});

router.get("/pay-periods/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [period] = await db.select().from(payPeriodsTable).where(eq(payPeriodsTable.id, id)).limit(1);

  if (!period) {
    res.status(404).json({ error: "Pay period not found" });
    return;
  }

  const entries = await db
    .select()
    .from(timeEntriesTable)
    .where(eq(timeEntriesTable.periodId, id))
    .orderBy(asc(timeEntriesTable.workDate), asc(timeEntriesTable.workerName));

  const payments = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.periodId, id))
    .orderBy(paymentsTable.workerName);

  const periodHotels = await db
    .select()
    .from(payPeriodHotelsTable)
    .where(eq(payPeriodHotelsTable.periodId, id))
    .orderBy(asc(payPeriodHotelsTable.hotelName));

  res.json({
    ...mapPeriod(period),
    periodHotels: periodHotels.map(mapPeriodHotel),
    entries: entries.map(mapEntry),
    payments: payments.map(mapPayment),
  });
});

// ─── Pay Period Hotels (Manual Sections) ───────────────────────────────────

router.get("/pay-periods/:periodId/hotels", async (req, res): Promise<void> => {
  const periodId = parseId(req.params.periodId);

  const rows = await db
    .select()
    .from(payPeriodHotelsTable)
    .where(eq(payPeriodHotelsTable.periodId, periodId))
    .orderBy(asc(payPeriodHotelsTable.hotelName));

  res.json(rows.map(mapPeriodHotel));
});

router.post("/pay-periods/:periodId/hotels", async (req, res): Promise<void> => {
  const periodId = parseId(req.params.periodId);
  const { hotelId, notes } = req.body;

  if (!hotelId) {
    res.status(400).json({ error: "hotelId is required" });
    return;
  }

  if (await isPeriodFinalized(periodId)) {
    res.status(409).json({ error: "Cannot change hotels in a finalized pay period" });
    return;
  }

  const [hotel] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, hotelId)).limit(1);
  if (!hotel) {
    res.status(404).json({ error: "Hotel not found" });
    return;
  }

  const [existing] = await db
    .select()
    .from(payPeriodHotelsTable)
    .where(and(eq(payPeriodHotelsTable.periodId, periodId), eq(payPeriodHotelsTable.hotelId, hotelId)))
    .limit(1);

  if (existing) {
    res.json(mapPeriodHotel(existing));
    return;
  }

  const [row] = await db
    .insert(payPeriodHotelsTable)
    .values({
      periodId,
      hotelId,
      hotelName: hotel.name,
      region: hotel.region ?? null,
      notes: notes || null,
    })
    .returning();

  res.status(201).json(mapPeriodHotel(row));
});

router.patch("/pay-periods/:periodId/hotels/:id", async (req, res): Promise<void> => {
  const periodId = parseId(req.params.periodId);
  const id = parseId(req.params.id);
  const { notes } = req.body;

  if (await isPeriodFinalized(periodId)) {
    res.status(409).json({ error: "Cannot change hotels in a finalized pay period" });
    return;
  }

  const [row] = await db
    .update(payPeriodHotelsTable)
    .set({ notes: notes ?? null })
    .where(and(eq(payPeriodHotelsTable.id, id), eq(payPeriodHotelsTable.periodId, periodId)))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Pay period hotel not found" });
    return;
  }

  res.json(mapPeriodHotel(row));
});

router.delete("/pay-periods/:periodId/hotels/:id", async (req, res): Promise<void> => {
  const periodId = parseId(req.params.periodId);
  const id = parseId(req.params.id);

  if (await isPeriodFinalized(periodId)) {
    res.status(409).json({ error: "Cannot change hotels in a finalized pay period" });
    return;
  }

  const [row] = await db
    .delete(payPeriodHotelsTable)
    .where(and(eq(payPeriodHotelsTable.id, id), eq(payPeriodHotelsTable.periodId, periodId)))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Pay period hotel not found" });
    return;
  }

  await db
    .update(timeEntriesTable)
    .set({ payPeriodHotelId: null })
    .where(and(eq(timeEntriesTable.periodId, periodId), eq(timeEntriesTable.payPeriodHotelId, id)));

  res.sendStatus(204);
});

router.patch("/pay-periods/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const { name, startDate, endDate, status, notes } = req.body;

  const update: Partial<typeof payPeriodsTable.$inferInsert> = {};
  if (name !== undefined) update.name = name;
  if (startDate !== undefined) update.startDate = startDate;
  if (endDate !== undefined) update.endDate = endDate;
  if (status !== undefined) update.status = status;
  if (notes !== undefined) update.notes = notes;

  const [period] = await db.update(payPeriodsTable).set(update).where(eq(payPeriodsTable.id, id)).returning();

  if (!period) {
    res.status(404).json({ error: "Pay period not found" });
    return;
  }

  res.json(mapPeriod(period));
});

router.delete("/pay-periods/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [period] = await db.delete(payPeriodsTable).where(eq(payPeriodsTable.id, id)).returning();

  if (!period) {
    res.status(404).json({ error: "Pay period not found" });
    return;
  }

  res.sendStatus(204);
});

// ─── Time Entries ────────────────────────────────────────────────────────────

router.get("/pay-periods/:periodId/entries", async (req, res): Promise<void> => {
  const periodId = parseId(req.params.periodId);
  const { hotelId, workerId, type } = req.query as Record<string, string>;

  const conditions = [eq(timeEntriesTable.periodId, periodId)];
  if (hotelId) conditions.push(eq(timeEntriesTable.hotelId, parseInt(hotelId)));
  if (workerId) conditions.push(eq(timeEntriesTable.workerId, parseInt(workerId)));
  if (type && type !== "all") conditions.push(eq(timeEntriesTable.entryType, type));

  const entries = await db
    .select()
    .from(timeEntriesTable)
    .where(and(...conditions))
    .orderBy(asc(timeEntriesTable.workDate), asc(timeEntriesTable.workerName));

  res.json(entries.map(mapEntry));
});

router.post("/pay-periods/:periodId/entries", async (req, res): Promise<void> => {
  const periodId = parseId(req.params.periodId);
  const {
    workerId,
    hotelId,
    payPeriodHotelId,
    role,
    entryType,
    workDate,
    regularHours,
    overtimeHours,
    otherHours,
    totalHours,
    hoursWorked,
    ratePerHour,
    flatAmount,
    totalAmount,
    paymentMethod,
    interacEmail,
    notes,
    region,
  } = req.body;

  if (await isPeriodFinalized(periodId)) {
    res.status(409).json({ error: "Cannot add entries to a finalized pay period" });
    return;
  }

  if (!workerId) {
    res.status(400).json({ error: "workerId is required" });
    return;
  }

  const resolvedHours = totalHours ?? hoursWorked ?? (Number(regularHours || 0) + Number(overtimeHours || 0) + Number(otherHours || 0));
  const resolvedAmount =
    totalAmount ??
    flatAmount ??
    (Number.isFinite(Number(resolvedHours)) && Number.isFinite(Number(ratePerHour)) ? Number(resolvedHours) * Number(ratePerHour) : 0);

  const [worker] = await db.select().from(workersTable).where(eq(workersTable.id, workerId)).limit(1);
  const workerName = worker?.name || "Unknown";

  let hotelName: string | null = null;
  if (hotelId) {
    const [hotel] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, hotelId)).limit(1);
    hotelName = hotel?.name || null;
  }

  const [entry] = await db
    .insert(timeEntriesTable)
    .values({
      periodId,
      payPeriodHotelId: payPeriodHotelId || null,
      workerId,
      hotelId: hotelId || null,
      workerName,
      hotelName,
      role: role || null,
      entryType: entryType || "payroll",
      workDate: workDate || null,
      regularHours: regularHours?.toString() ?? null,
      overtimeHours: overtimeHours?.toString() ?? null,
      otherHours: otherHours?.toString() ?? null,
      totalHours: resolvedHours?.toString() ?? null,
      hoursWorked: resolvedHours?.toString() ?? null,
      ratePerHour: ratePerHour?.toString() ?? null,
      flatAmount: flatAmount?.toString() ?? null,
      totalAmount: resolvedAmount.toString(),
      paymentStatus: "pending",
      paymentMethod: paymentMethod || worker?.paymentMethod || null,
      interacEmail: interacEmail || worker?.interacEmail || null,
      notes,
      region: region || null,
    })
    .returning();

  await recalcPeriodTotals(periodId);
  res.status(201).json(mapEntry(entry));
});

router.post("/pay-periods/:periodId/entries/bulk", async (req, res): Promise<void> => {
  const periodId = parseId(req.params.periodId);
  const { entries, replaceAll } = req.body;

  if (await isPeriodFinalized(periodId)) {
    res.status(409).json({ error: "Cannot modify entries in a finalized pay period" });
    return;
  }

  if (!Array.isArray(entries)) {
    res.status(400).json({ error: "entries must be an array" });
    return;
  }

  if (replaceAll) {
    await db.delete(timeEntriesTable).where(eq(timeEntriesTable.periodId, periodId));
  }

  let inserted = 0;

  for (const e of entries) {
    const [worker] = await db.select().from(workersTable).where(eq(workersTable.id, e.workerId)).limit(1);
    const workerName = worker?.name || e.workerName || "Unknown";

    let hotelName: string | null = null;
    if (e.hotelId) {
      const [hotel] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, e.hotelId)).limit(1);
      hotelName = hotel?.name || null;
    }

    await db.insert(timeEntriesTable).values({
      periodId,
      payPeriodHotelId: e.payPeriodHotelId || null,
      workerId: e.workerId,
      hotelId: e.hotelId || null,
      workerName,
      hotelName,
      role: e.role || null,
      entryType: e.entryType || "payroll",
      workDate: e.workDate || null,
      regularHours: e.regularHours?.toString() ?? null,
      overtimeHours: e.overtimeHours?.toString() ?? null,
      otherHours: e.otherHours?.toString() ?? null,
      totalHours: (e.totalHours ?? e.hoursWorked)?.toString() ?? null,
      hoursWorked: (e.totalHours ?? e.hoursWorked)?.toString() ?? null,
      ratePerHour: e.ratePerHour?.toString() ?? null,
      flatAmount: e.flatAmount?.toString() ?? null,
      totalAmount: (e.totalAmount || 0).toString(),
      paymentStatus: "pending",
      paymentMethod: e.paymentMethod || worker?.paymentMethod || null,
      interacEmail: e.interacEmail || worker?.interacEmail || null,
      notes: e.notes || null,
      region: e.region || null,
    });
    inserted++;
  }

  await recalcPeriodTotals(periodId);

  res.json({ inserted, updated: 0, total: inserted });
});

router.patch("/pay-periods/:periodId/entries/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const periodId = parseId(req.params.periodId);
  const body = req.body;

  if (await isPeriodFinalized(periodId)) {
    res.status(409).json({ error: "Cannot edit entries in a finalized pay period" });
    return;
  }

  const update: Partial<typeof timeEntriesTable.$inferInsert> = {};
  if (body.payPeriodHotelId !== undefined) update.payPeriodHotelId = body.payPeriodHotelId;
  if (body.workerId !== undefined) update.workerId = body.workerId;
  if (body.hotelId !== undefined) update.hotelId = body.hotelId;
  if (body.role !== undefined) update.role = body.role;
  if (body.entryType !== undefined) update.entryType = body.entryType;
  if (body.workDate !== undefined) update.workDate = body.workDate || null;
  if (body.regularHours !== undefined) update.regularHours = body.regularHours?.toString() ?? null;
  if (body.overtimeHours !== undefined) update.overtimeHours = body.overtimeHours?.toString() ?? null;
  if (body.otherHours !== undefined) update.otherHours = body.otherHours?.toString() ?? null;
  if (body.totalHours !== undefined) {
    update.totalHours = body.totalHours?.toString() ?? null;
    update.hoursWorked = body.totalHours?.toString() ?? null;
  }
  if (body.hoursWorked !== undefined) update.hoursWorked = body.hoursWorked?.toString() ?? null;
  if (body.ratePerHour !== undefined) update.ratePerHour = body.ratePerHour?.toString() ?? null;
  if (body.flatAmount !== undefined) update.flatAmount = body.flatAmount?.toString() ?? null;
  if (body.totalAmount !== undefined) update.totalAmount = body.totalAmount.toString();
  if (body.paymentStatus !== undefined) update.paymentStatus = body.paymentStatus;
  if (body.paymentMethod !== undefined) update.paymentMethod = body.paymentMethod;
  if (body.interacEmail !== undefined) update.interacEmail = body.interacEmail;
  if (body.notes !== undefined) update.notes = body.notes;
  if (body.region !== undefined) update.region = body.region;

  if (body.workerId) {
    const [worker] = await db.select().from(workersTable).where(eq(workersTable.id, body.workerId)).limit(1);
    if (worker) update.workerName = worker.name;
  }
  if (body.hotelId) {
    const [hotel] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, body.hotelId)).limit(1);
    if (hotel) update.hotelName = hotel.name;
  }
  if (body.hotelId === null) {
    update.hotelName = null;
  }

  const [entry] = await db
    .update(timeEntriesTable)
    .set(update)
    .where(and(eq(timeEntriesTable.id, id), eq(timeEntriesTable.periodId, periodId)))
    .returning();

  if (!entry) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }

  await recalcPeriodTotals(periodId);
  res.json(mapEntry(entry));
});

router.delete("/pay-periods/:periodId/entries/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const periodId = parseId(req.params.periodId);

  if (await isPeriodFinalized(periodId)) {
    res.status(409).json({ error: "Cannot delete entries in a finalized pay period" });
    return;
  }

  const [entry] = await db
    .delete(timeEntriesTable)
    .where(and(eq(timeEntriesTable.id, id), eq(timeEntriesTable.periodId, periodId)))
    .returning();

  if (!entry) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }

  await recalcPeriodTotals(periodId);
  res.sendStatus(204);
});

// ─── Tally ───────────────────────────────────────────────────────────────────

router.get("/pay-periods/:periodId/tally", async (req, res): Promise<void> => {
  const periodId = parseId(req.params.periodId);

  const entries = await db
    .select()
    .from(timeEntriesTable)
    .where(eq(timeEntriesTable.periodId, periodId));

  const totalPayroll = entries
    .filter((e) => e.entryType === "payroll")
    .reduce((sum, e) => sum + Number(e.totalAmount), 0);

  const totalSubcontractors = entries
    .filter((e) => e.entryType === "subcontractor")
    .reduce((sum, e) => sum + Number(e.totalAmount), 0);

  const grandTotal = totalPayroll + totalSubcontractors;

  const workerIds = new Set(entries.map((e) => e.workerId));
  const hotelNames = new Set(entries.map((e) => e.hotelName).filter(Boolean));

  const missingInfoCount = entries.filter(
    (e) => !e.paymentMethod && !e.interacEmail,
  ).length;

  const byHotelMap = new Map<string, { hotelId: number | null; totalAmount: number; workerCount: number; region: string | null }>();
  for (const e of entries) {
    const key = e.hotelName || "Unknown Hotel";
    const existing = byHotelMap.get(key);
    if (existing) {
      existing.totalAmount += Number(e.totalAmount);
      existing.workerCount++;
    } else {
      byHotelMap.set(key, { hotelId: e.hotelId, totalAmount: Number(e.totalAmount), workerCount: 1, region: e.region });
    }
  }

  const byWorkerMap = new Map<number, { workerName: string; entryType: string; totalAmount: number; paymentStatus: string; paymentMethod: string | null }>();
  for (const e of entries) {
    const existing = byWorkerMap.get(e.workerId);
    if (existing) {
      existing.totalAmount += Number(e.totalAmount);
    } else {
      byWorkerMap.set(e.workerId, {
        workerName: e.workerName,
        entryType: e.entryType,
        totalAmount: Number(e.totalAmount),
        paymentStatus: e.paymentStatus,
        paymentMethod: e.paymentMethod,
      });
    }
  }

  const byRegionMap = new Map<string, { totalAmount: number; workerCount: number }>();
  for (const e of entries) {
    const region = e.region || "Other";
    const existing = byRegionMap.get(region);
    if (existing) {
      existing.totalAmount += Number(e.totalAmount);
      existing.workerCount++;
    } else {
      byRegionMap.set(region, { totalAmount: Number(e.totalAmount), workerCount: 1 });
    }
  }

  res.json({
    periodId,
    totalPayroll,
    totalSubcontractors,
    grandTotal,
    workerCount: workerIds.size,
    hotelCount: hotelNames.size,
    missingInfoCount,
    byHotel: Array.from(byHotelMap.entries()).map(([hotelName, v]) => ({ hotelName, ...v })),
    byWorker: Array.from(byWorkerMap.entries()).map(([workerId, v]) => ({ workerId, ...v })),
    byRegion: Array.from(byRegionMap.entries()).map(([region, v]) => ({ region, ...v })),
  });
});

// ─── Payments ────────────────────────────────────────────────────────────────

router.get("/pay-periods/:periodId/payments", async (req, res): Promise<void> => {
  const periodId = parseId(req.params.periodId);
  const { method } = req.query as Record<string, string>;

  const conditions = [eq(paymentsTable.periodId, periodId)];
  if (method && method !== "all") conditions.push(eq(paymentsTable.paymentMethod, method));

  const payments = await db
    .select()
    .from(paymentsTable)
    .where(and(...conditions))
    .orderBy(paymentsTable.workerName);

  res.json(payments.map(mapPayment));
});

router.post("/pay-periods/:periodId/payments", async (req, res): Promise<void> => {
  const periodId = parseId(req.params.periodId);
  const { workerId, amount, paymentMethod, interacEmail, chequeNumber, notes } = req.body;

  if (!workerId || amount === undefined || !paymentMethod) {
    res.status(400).json({ error: "workerId, amount, paymentMethod are required" });
    return;
  }

  const [worker] = await db.select().from(workersTable).where(eq(workersTable.id, workerId)).limit(1);

  const [payment] = await db
    .insert(paymentsTable)
    .values({
      periodId,
      workerId,
      workerName: worker?.name || "Unknown",
      amount: amount.toString(),
      paymentMethod,
      interacEmail: interacEmail || null,
      chequeNumber: chequeNumber || null,
      status: "pending",
      notes: notes || null,
    })
    .returning();

  res.status(201).json(mapPayment(payment));
});

router.patch("/pay-periods/:periodId/payments/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const periodId = parseId(req.params.periodId);
  const body = req.body;

  const update: Partial<typeof paymentsTable.$inferInsert> = {};
  if (body.amount !== undefined) update.amount = body.amount.toString();
  if (body.paymentMethod !== undefined) update.paymentMethod = body.paymentMethod;
  if (body.interacEmail !== undefined) update.interacEmail = body.interacEmail;
  if (body.chequeNumber !== undefined) update.chequeNumber = body.chequeNumber;
  if (body.status !== undefined) update.status = body.status;
  if (body.notes !== undefined) update.notes = body.notes;

  const [payment] = await db
    .update(paymentsTable)
    .set(update)
    .where(and(eq(paymentsTable.id, id), eq(paymentsTable.periodId, periodId)))
    .returning();

  if (!payment) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  res.json(mapPayment(payment));
});

router.delete("/pay-periods/:periodId/payments/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const periodId = parseId(req.params.periodId);

  const [payment] = await db
    .delete(paymentsTable)
    .where(and(eq(paymentsTable.id, id), eq(paymentsTable.periodId, periodId)))
    .returning();

  if (!payment) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/pay-periods/:periodId/payments/:id/mark-paid", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const periodId = parseId(req.params.periodId);

  const [payment] = await db
    .update(paymentsTable)
    .set({ status: "cleared", paidAt: new Date() })
    .where(and(eq(paymentsTable.id, id), eq(paymentsTable.periodId, periodId)))
    .returning();

  if (!payment) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  res.json(mapPayment(payment));
});

// ─── Export ───────────────────────────────────────────────────────────────────

router.get("/pay-periods/:periodId/export", async (req, res): Promise<void> => {
  const periodId = parseId(req.params.periodId);
  const { type } = req.query as Record<string, string>;

  const entries = await db
    .select()
    .from(timeEntriesTable)
    .where(eq(timeEntriesTable.periodId, periodId))
    .orderBy(asc(timeEntriesTable.workDate), asc(timeEntriesTable.workerName));

  const payments = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.periodId, periodId))
    .orderBy(paymentsTable.workerName);

  let csvData = "";
  let filename = `export_${type}_${periodId}.csv`;
  let rowCount = 0;

  if (type === "payroll") {
    const rows = entries.filter((e) => e.entryType === "payroll");
    csvData = "Worker,Hotel,Hours,Rate,Total,Payment Method,Interac Email,Status,Notes\n";
    for (const r of rows) {
      csvData += `"${r.workerName}","${r.hotelName || ""}","${r.hoursWorked || ""}","${r.ratePerHour || ""}","${Number(r.totalAmount).toFixed(2)}","${r.paymentMethod || ""}","${r.interacEmail || ""}","${r.paymentStatus}","${r.notes || ""}"\n`;
    }
    rowCount = rows.length;
    filename = `payroll_${periodId}.csv`;
  } else if (type === "subcontractors") {
    const rows = entries.filter((e) => e.entryType === "subcontractor");
    csvData = "Worker,Hotel,Hours,Rate,Total,Payment Method,Interac Email,Status,Notes\n";
    for (const r of rows) {
      csvData += `"${r.workerName}","${r.hotelName || ""}","${r.hoursWorked || ""}","${r.ratePerHour || ""}","${Number(r.totalAmount).toFixed(2)}","${r.paymentMethod || ""}","${r.interacEmail || ""}","${r.paymentStatus}","${r.notes || ""}"\n`;
    }
    rowCount = rows.length;
    filename = `subcontractors_${periodId}.csv`;
  } else if (type === "etransfer") {
    const rows = payments.filter((p) => p.paymentMethod === "etransfer");
    csvData = "Worker,Amount,Interac Email,Status\n";
    for (const r of rows) {
      csvData += `"${r.workerName}","${Number(r.amount).toFixed(2)}","${r.interacEmail || ""}","${r.status}"\n`;
    }
    rowCount = rows.length;
    filename = `etransfer_${periodId}.csv`;
  } else if (type === "cheque") {
    const rows = payments.filter((p) => p.paymentMethod === "cheque");
    csvData = "Worker,Amount,Cheque Number,Status\n";
    for (const r of rows) {
      csvData += `"${r.workerName}","${Number(r.amount).toFixed(2)}","${r.chequeNumber || ""}","${r.status}"\n`;
    }
    rowCount = rows.length;
    filename = `cheque_${periodId}.csv`;
  } else if (type === "tally") {
    csvData = "Worker,Type,Hotel,Hours,Rate,Total,Payment Method,Status\n";
    for (const r of entries) {
      csvData += `"${r.workerName}","${r.entryType}","${r.hotelName || ""}","${r.hoursWorked || ""}","${r.ratePerHour || ""}","${Number(r.totalAmount).toFixed(2)}","${r.paymentMethod || ""}","${r.paymentStatus}"\n`;
    }
    rowCount = entries.length;
    filename = `tally_${periodId}.csv`;
  } else if (type === "missing") {
    const rows = entries.filter((e) => !e.paymentMethod && !e.interacEmail);
    csvData = "Worker,Type,Hotel,Total,Notes\n";
    for (const r of rows) {
      csvData += `"${r.workerName}","${r.entryType}","${r.hotelName || ""}","${Number(r.totalAmount).toFixed(2)}","${r.notes || ""}"\n`;
    }
    rowCount = rows.length;
    filename = `missing_info_${periodId}.csv`;
  } else {
    res.status(400).json({ error: "Invalid export type" });
    return;
  }

  res.json({ type, filename, csvData, rowCount });
});

export default router;
