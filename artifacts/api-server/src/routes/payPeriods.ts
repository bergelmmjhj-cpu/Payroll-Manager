import { Router, type IRouter } from "express";
import { db, payPeriodsTable, payPeriodHotelsTable, timeEntriesTable, paymentsTable, workersTable, hotelsTable, workerHotelRatesTable } from "@workspace/db";
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

type HotelPosition = {
  title?: string | null;
  rate?: string | number | null;
};

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRole(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function readHotelPositions(value: unknown): HotelPosition[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is HotelPosition => Boolean(item && typeof item === "object"));
}

function resolveHotelFallbackRate(
  hotel: Pick<typeof hotelsTable.$inferSelect, "payRate" | "positions"> | null | undefined,
  role: unknown,
): number | null {
  if (!hotel) return null;

  const normalizedRole = normalizeRole(role);
  const positions = readHotelPositions(hotel.positions);

  if (normalizedRole) {
    const exactPosition = positions.find((position) => normalizeRole(position.title) === normalizedRole);
    const exactRate = toNumberOrNull(exactPosition?.rate);
    if (exactRate != null) return exactRate;
  }

  const firstPositionRate = toNumberOrNull(positions[0]?.rate);
  if (firstPositionRate != null) return firstPositionRate;

  return toNumberOrNull(hotel.payRate);
}

async function resolveRatePerHour({
  workerId,
  hotelId,
  role,
  explicitRate,
  worker,
  hotel,
}: {
  workerId: number;
  hotelId: number | null;
  role?: unknown;
  explicitRate?: unknown;
  worker?: typeof workersTable.$inferSelect | null;
  hotel?: typeof hotelsTable.$inferSelect | null;
}): Promise<number | null> {
  const explicit = toNumberOrNull(explicitRate);
  if (explicit != null) return explicit;

  if (hotelId != null) {
    const overrides = await db
      .select()
      .from(workerHotelRatesTable)
      .where(and(eq(workerHotelRatesTable.workerId, workerId), eq(workerHotelRatesTable.hotelId, hotelId)));

    const normalizedRole = normalizeRole(role);
    const exact = overrides.find((item) => normalizeRole(item.role) === normalizedRole);
    const generic = overrides.find((item) => normalizeRole(item.role) == null);
    const overrideRate = toNumberOrNull((exact ?? generic)?.rate);
    if (overrideRate != null) return overrideRate;
  }

  const resolvedWorker = worker ?? (await db.select().from(workersTable).where(eq(workersTable.id, workerId)).limit(1))[0] ?? null;
  const workerRate = toNumberOrNull(resolvedWorker?.defaultRate);
  if (workerRate != null) return workerRate;

  const resolvedHotel = hotelId == null
    ? null
    : hotel ?? (await db.select().from(hotelsTable).where(eq(hotelsTable.id, hotelId)).limit(1))[0] ?? null;

  return resolveHotelFallbackRate(resolvedHotel, role);
}

async function rememberWorkerHotelRate({
  workerId,
  hotelId,
  role,
  rate,
}: {
  workerId: number;
  hotelId: number | null;
  role?: unknown;
  rate: number | null;
}): Promise<void> {
  if (hotelId == null || rate == null) return;

  const normalizedRole = normalizeRole(role);
  const existingRates = await db
    .select()
    .from(workerHotelRatesTable)
    .where(and(eq(workerHotelRatesTable.workerId, workerId), eq(workerHotelRatesTable.hotelId, hotelId)));

  const existing = existingRates.find((item) => normalizeRole(item.role) === normalizedRole);

  if (existing) {
    await db
      .update(workerHotelRatesTable)
      .set({ rate: String(rate), role: normalizedRole ?? null })
      .where(eq(workerHotelRatesTable.id, existing.id));
    return;
  }

  await db.insert(workerHotelRatesTable).values({
    workerId,
    hotelId,
    role: normalizedRole ?? null,
    rate: String(rate),
  });
}

function hasRowContent(entry: Record<string, unknown>): boolean {
  return [
    entry.workerId,
    entry.role,
    entry.workDate,
    entry.regularHours,
    entry.overtimeHours,
    entry.otherHours,
    entry.totalHours,
    entry.hoursWorked,
    entry.ratePerHour,
    entry.flatAmount,
    entry.notes,
  ].some((value) => value !== null && value !== undefined && `${value}`.trim() !== "");
}

function ensureNonNegativeNumber(name: string, value: unknown): string | null {
  const parsed = toNumberOrNull(value);
  if (parsed == null) return null;
  if (parsed < 0) return `${name} cannot be negative`;
  return null;
}

function resolveHoursPayload(entry: Record<string, unknown>): number | null {
  const explicit = toNumberOrNull(entry.totalHours ?? entry.hoursWorked);
  if (explicit != null) return explicit;

  const regularHours = toNumberOrNull(entry.regularHours) ?? 0;
  const overtimeHours = toNumberOrNull(entry.overtimeHours) ?? 0;
  const otherHours = toNumberOrNull(entry.otherHours) ?? 0;
  const total = regularHours + overtimeHours + otherHours;
  return total > 0 ? total : null;
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

router.post("/pay-periods/:periodId/hotels/:id/entries/save", async (req, res): Promise<void> => {
  const periodId = parseId(req.params.periodId);
  const sectionId = parseId(req.params.id);
  const { entries } = req.body as { entries?: Array<Record<string, unknown>> };

  if (await isPeriodFinalized(periodId)) {
    res.status(409).json({ error: "Cannot edit entries in a finalized pay period" });
    return;
  }

  if (!Array.isArray(entries)) {
    res.status(400).json({ error: "entries must be an array" });
    return;
  }

  const [section] = await db
    .select()
    .from(payPeriodHotelsTable)
    .where(and(eq(payPeriodHotelsTable.id, sectionId), eq(payPeriodHotelsTable.periodId, periodId)))
    .limit(1);

  if (!section) {
    res.status(404).json({ error: "Pay period hotel not found" });
    return;
  }

  const [hotel] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, section.hotelId)).limit(1);
  const existingEntries = await db
    .select()
    .from(timeEntriesTable)
    .where(and(eq(timeEntriesTable.periodId, periodId), eq(timeEntriesTable.payPeriodHotelId, sectionId)));

  const keptIds = new Set<number>();
  let inserted = 0;
  let updated = 0;

  for (const rawEntry of entries) {
    if (!hasRowContent(rawEntry)) continue;

    const workerId = toNumberOrNull(rawEntry.workerId);
    if (workerId == null) {
      res.status(400).json({ error: "Each saved row must include a worker" });
      return;
    }

    const numericError = [
      ensureNonNegativeNumber("Regular hours", rawEntry.regularHours),
      ensureNonNegativeNumber("OT hours", rawEntry.overtimeHours),
      ensureNonNegativeNumber("Other hours", rawEntry.otherHours),
      ensureNonNegativeNumber("Total hours", rawEntry.totalHours ?? rawEntry.hoursWorked),
      ensureNonNegativeNumber("Rate", rawEntry.ratePerHour),
      ensureNonNegativeNumber("Flat amount", rawEntry.flatAmount),
    ].find(Boolean);

    if (numericError) {
      res.status(400).json({ error: numericError });
      return;
    }

    const [worker] = await db.select().from(workersTable).where(eq(workersTable.id, workerId)).limit(1);
    if (!worker) {
      res.status(404).json({ error: `Worker ${workerId} not found` });
      return;
    }

    const resolvedHours = resolveHoursPayload(rawEntry);
    const resolvedRate = await resolveRatePerHour({
      workerId,
      hotelId: section.hotelId,
      role: rawEntry.role,
      explicitRate: rawEntry.ratePerHour,
      worker,
      hotel,
    });
    const resolvedFlatAmount = toNumberOrNull(rawEntry.flatAmount);
    const explicitTotalAmount = toNumberOrNull(rawEntry.totalAmount);
    const resolvedTotalAmount = explicitTotalAmount
      ?? resolvedFlatAmount
      ?? ((resolvedHours ?? 0) * (resolvedRate ?? 0));
    const entryType = typeof rawEntry.entryType === "string" && rawEntry.entryType === "subcontractor"
      ? "subcontractor"
      : worker.workerType === "subcontractor"
        ? "subcontractor"
        : "payroll";

    const values = {
      periodId,
      payPeriodHotelId: sectionId,
      workerId,
      hotelId: section.hotelId,
      workerName: worker.name,
      hotelName: section.hotelName,
      role: typeof rawEntry.role === "string" && rawEntry.role.trim() ? rawEntry.role.trim() : null,
      entryType,
      workDate: typeof rawEntry.workDate === "string" && rawEntry.workDate ? rawEntry.workDate : null,
      regularHours: toNumberOrNull(rawEntry.regularHours)?.toString() ?? null,
      overtimeHours: toNumberOrNull(rawEntry.overtimeHours)?.toString() ?? null,
      otherHours: toNumberOrNull(rawEntry.otherHours)?.toString() ?? null,
      totalHours: resolvedHours?.toString() ?? null,
      hoursWorked: resolvedHours?.toString() ?? null,
      ratePerHour: resolvedRate?.toString() ?? null,
      flatAmount: resolvedFlatAmount?.toString() ?? null,
      totalAmount: resolvedTotalAmount.toString(),
      paymentStatus: "pending" as const,
      paymentMethod: typeof rawEntry.paymentMethod === "string" ? rawEntry.paymentMethod : worker.paymentMethod,
      interacEmail: typeof rawEntry.interacEmail === "string" ? rawEntry.interacEmail : worker.interacEmail,
      notes: typeof rawEntry.notes === "string" && rawEntry.notes.trim() ? rawEntry.notes.trim() : null,
      region: hotel?.region ?? section.region ?? null,
    };

    const entryId = toNumberOrNull(rawEntry.id);
    if (entryId != null) {
      const [savedEntry] = await db
        .update(timeEntriesTable)
        .set(values)
        .where(and(eq(timeEntriesTable.id, entryId), eq(timeEntriesTable.periodId, periodId), eq(timeEntriesTable.payPeriodHotelId, sectionId)))
        .returning();

      if (!savedEntry) {
        res.status(404).json({ error: `Entry ${entryId} not found` });
        return;
      }

      keptIds.add(savedEntry.id);
      updated++;
    } else {
      const [savedEntry] = await db.insert(timeEntriesTable).values(values).returning();
      keptIds.add(savedEntry.id);
      inserted++;
    }

    await rememberWorkerHotelRate({
      workerId,
      hotelId: section.hotelId,
      role: rawEntry.role,
      rate: resolvedRate,
    });
  }

  const deletedIds = existingEntries.filter((entry) => !keptIds.has(entry.id)).map((entry) => entry.id);
  if (deletedIds.length > 0) {
    for (const entryId of deletedIds) {
      await db
        .delete(timeEntriesTable)
        .where(and(eq(timeEntriesTable.id, entryId), eq(timeEntriesTable.periodId, periodId), eq(timeEntriesTable.payPeriodHotelId, sectionId)));
    }
  }

  await recalcPeriodTotals(periodId);

  res.json({
    inserted,
    updated,
    deleted: deletedIds.length,
    total: inserted + updated,
  });
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

  const [worker] = await db.select().from(workersTable).where(eq(workersTable.id, workerId)).limit(1);
  const workerName = worker?.name || "Unknown";

  let hotelName: string | null = null;
  let hotel: typeof hotelsTable.$inferSelect | null = null;
  if (hotelId) {
    [hotel] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, hotelId)).limit(1);
    hotelName = hotel?.name || null;
  }

  const resolvedHours = resolveHoursPayload({ regularHours, overtimeHours, otherHours, totalHours, hoursWorked });
  const resolvedRate = await resolveRatePerHour({
    workerId,
    hotelId: hotelId || null,
    role,
    explicitRate: ratePerHour,
    worker,
    hotel,
  });
  const resolvedAmount =
    toNumberOrNull(totalAmount) ??
    toNumberOrNull(flatAmount) ??
    ((resolvedHours ?? 0) * (resolvedRate ?? 0));

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
      ratePerHour: resolvedRate?.toString() ?? null,
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
  await rememberWorkerHotelRate({ workerId, hotelId: hotelId || null, role, rate: resolvedRate });
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
  await rememberWorkerHotelRate({
    workerId: entry.workerId,
    hotelId: entry.hotelId,
    role: entry.role,
    rate: toNumberOrNull(entry.ratePerHour),
  });
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
