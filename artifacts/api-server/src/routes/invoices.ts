import { Router, type IRouter } from "express";
import { db, invoicesTable, invoiceLineItemsTable, businessProfilesTable, logosTable, timeEntriesTable, hotelsTable, payPeriodsTable } from "@workspace/db";
import { eq, desc, and, ilike } from "drizzle-orm";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s, 10);
}

function mapInvoice(inv: typeof invoicesTable.$inferSelect) {
  return {
    ...inv,
    subtotal: Number(inv.subtotal),
    taxAmount: Number(inv.taxAmount),
    total: Number(inv.total),
    taxRate: inv.taxRate ? Number(inv.taxRate) : null,
  };
}

function mapLine(line: typeof invoiceLineItemsTable.$inferSelect) {
  return {
    ...line,
    hours: line.hours ? Number(line.hours) : null,
    rate: line.rate ? Number(line.rate) : null,
    amount: Number(line.amount),
  };
}

async function getInvoiceDetail(id: number) {
  const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id)).limit(1);
  if (!inv) return null;

  const lineItems = await db
    .select()
    .from(invoiceLineItemsTable)
    .where(eq(invoiceLineItemsTable.invoiceId, id))
    .orderBy(invoiceLineItemsTable.sortOrder);

  let businessProfile = null;
  if (inv.businessProfileId) {
    const [bp] = await db.select().from(businessProfilesTable).where(eq(businessProfilesTable.id, inv.businessProfileId)).limit(1);
    if (bp) {
      let logoUrl: string | null = null;
      if (bp.logoId) {
        const [logo] = await db.select().from(logosTable).where(eq(logosTable.id, bp.logoId)).limit(1);
        if (logo) logoUrl = logo.dataUrl;
      }
      businessProfile = { ...bp, logoUrl };
    }
  }

  return {
    ...mapInvoice(inv),
    lineItems: lineItems.map(mapLine),
    businessProfile,
  };
}

async function getNextInvoiceNumber(): Promise<string> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(invoicesTable);
  const nextNum = (result?.count ?? 0) + 1;
  return `INV-${String(nextNum).padStart(4, "0")}`;
}

async function saveLineItems(invoiceId: number, lineItems: any[]) {
  await db.delete(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, invoiceId));

  for (const item of lineItems) {
    await db.insert(invoiceLineItemsTable).values({
      invoiceId,
      description: item.description,
      hours: item.hours?.toString() ?? null,
      rate: item.rate?.toString() ?? null,
      amount: item.amount.toString(),
      sortOrder: item.sortOrder ?? 0,
    });
  }
}

function calcTotals(lineItems: any[], taxRate?: number | null) {
  const subtotal = lineItems.reduce((sum, l) => sum + Number(l.amount), 0);
  const taxAmount = taxRate ? subtotal * taxRate : 0;
  const total = subtotal + taxAmount;
  return { subtotal, taxAmount, total };
}

router.get("/invoices", async (req, res): Promise<void> => {
  const { status, clientName, periodId } = req.query as Record<string, string>;

  let query = db.select().from(invoicesTable).$dynamic();

  if (status && status !== "all") {
    query = query.where(eq(invoicesTable.status, status));
  }
  if (clientName) {
    query = query.where(ilike(invoicesTable.clientName, `%${clientName}%`));
  }
  if (periodId) {
    query = query.where(eq(invoicesTable.periodId, parseInt(periodId)));
  }

  const invoices = await query.orderBy(desc(invoicesTable.createdAt));
  res.json(invoices.map(mapInvoice));
});

router.post("/invoices", async (req, res): Promise<void> => {
  const { invoiceNumber, businessProfileId, clientName, clientAddress, periodId, invoiceDate, dueDate, serviceDescription, notes, taxRate, lineItems } = req.body;

  if (!clientName || !invoiceDate) {
    res.status(400).json({ error: "clientName and invoiceDate are required" });
    return;
  }

  const items = lineItems || [];
  const { subtotal, taxAmount, total } = calcTotals(items, taxRate);

  let businessName: string | null = null;
  if (businessProfileId) {
    const [bp] = await db.select().from(businessProfilesTable).where(eq(businessProfilesTable.id, businessProfileId)).limit(1);
    businessName = bp?.businessName ?? null;
  }

  const [invoice] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: invoiceNumber || (await getNextInvoiceNumber()),
      businessProfileId: businessProfileId || null,
      businessName,
      clientName,
      clientAddress: clientAddress || null,
      periodId: periodId || null,
      invoiceDate,
      dueDate: dueDate || null,
      serviceDescription: serviceDescription || null,
      notes: notes || null,
      taxRate: taxRate?.toString() ?? null,
      subtotal: subtotal.toString(),
      taxAmount: taxAmount.toString(),
      total: total.toString(),
      status: "draft",
    })
    .returning();

  await saveLineItems(invoice.id, items);

  res.status(201).json(await getInvoiceDetail(invoice.id));
});

router.post("/invoices/generate-from-period", async (req, res): Promise<void> => {
  const { periodId, hotelId, businessProfileId, invoiceDate, dueDate, taxRate, notes } = req.body;

  if (!periodId || !invoiceDate) {
    res.status(400).json({ error: "periodId and invoiceDate are required" });
    return;
  }

  const conditions = [eq(timeEntriesTable.periodId, periodId)];
  if (hotelId) conditions.push(eq(timeEntriesTable.hotelId, hotelId));

  const entries = await db
    .select()
    .from(timeEntriesTable)
    .where(and(...conditions))
    .orderBy(timeEntriesTable.workerName);

  const [period] = await db.select().from(payPeriodsTable).where(eq(payPeriodsTable.id, periodId)).limit(1);

  let clientName = "Client";
  let clientAddress: string | null = null;

  if (hotelId) {
    const [hotel] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, hotelId)).limit(1);
    if (hotel) {
      clientName = hotel.name;
      clientAddress = [hotel.address, hotel.city, hotel.province].filter(Boolean).join(", ");
    }
  }

  const lineItems = entries.map((e, idx) => ({
    description: `${e.workerName}${e.hotelName ? ` - ${e.hotelName}` : ""}${e.hoursWorked ? ` (${e.hoursWorked} hrs @ $${e.ratePerHour}/hr)` : ""}`,
    hours: e.hoursWorked ? Number(e.hoursWorked) : null,
    rate: e.ratePerHour ? Number(e.ratePerHour) : null,
    amount: Number(e.totalAmount),
    sortOrder: idx,
  }));

  const { subtotal, taxAmount, total } = calcTotals(lineItems, taxRate);

  let businessName: string | null = null;
  let resolvedBusinessProfileId = businessProfileId;
  if (!resolvedBusinessProfileId) {
    const defaultProfiles = await db.select().from(businessProfilesTable).where(eq(businessProfilesTable.isDefault, true)).limit(1);
    if (defaultProfiles.length > 0) {
      resolvedBusinessProfileId = defaultProfiles[0].id;
      businessName = defaultProfiles[0].businessName;
    }
  } else {
    const [bp] = await db.select().from(businessProfilesTable).where(eq(businessProfilesTable.id, resolvedBusinessProfileId)).limit(1);
    businessName = bp?.businessName ?? null;
  }

  const [invoice] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: await getNextInvoiceNumber(),
      businessProfileId: resolvedBusinessProfileId || null,
      businessName,
      clientName,
      clientAddress,
      periodId,
      invoiceDate,
      dueDate: dueDate || null,
      serviceDescription: period ? `Housekeeping services for period ${period.startDate} to ${period.endDate}` : null,
      notes: notes || null,
      taxRate: taxRate?.toString() ?? null,
      subtotal: subtotal.toString(),
      taxAmount: taxAmount.toString(),
      total: total.toString(),
      status: "draft",
    })
    .returning();

  await saveLineItems(invoice.id, lineItems);

  res.status(201).json(await getInvoiceDetail(invoice.id));
});

router.get("/invoices/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const detail = await getInvoiceDetail(id);

  if (!detail) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  res.json(detail);
});

router.patch("/invoices/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const body = req.body;

  const update: Partial<typeof invoicesTable.$inferInsert> = {};
  const stringFields = ["invoiceNumber", "clientName", "clientAddress", "invoiceDate", "dueDate", "serviceDescription", "notes"] as const;
  for (const f of stringFields) {
    if (body[f] !== undefined) (update as any)[f] = body[f];
  }

  if (body.businessProfileId !== undefined) {
    update.businessProfileId = body.businessProfileId;
    if (body.businessProfileId) {
      const [bp] = await db.select().from(businessProfilesTable).where(eq(businessProfilesTable.id, body.businessProfileId)).limit(1);
      update.businessName = bp?.businessName ?? null;
    }
  }
  if (body.periodId !== undefined) update.periodId = body.periodId;
  if (body.taxRate !== undefined) update.taxRate = body.taxRate?.toString() ?? null;

  if (body.lineItems) {
    const { subtotal, taxAmount, total } = calcTotals(body.lineItems, body.taxRate ?? null);
    update.subtotal = subtotal.toString();
    update.taxAmount = taxAmount.toString();
    update.total = total.toString();
    await saveLineItems(id, body.lineItems);
  }

  const [invoice] = await db.update(invoicesTable).set(update).where(eq(invoicesTable.id, id)).returning();

  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  res.json(await getInvoiceDetail(id));
});

router.delete("/invoices/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [invoice] = await db.delete(invoicesTable).where(eq(invoicesTable.id, id)).returning();

  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/invoices/:id/mark-sent", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [invoice] = await db.update(invoicesTable).set({ status: "sent" }).where(eq(invoicesTable.id, id)).returning();

  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  res.json(mapInvoice(invoice));
});

router.post("/invoices/:id/mark-paid", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [invoice] = await db.update(invoicesTable).set({ status: "paid" }).where(eq(invoicesTable.id, id)).returning();

  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  res.json(mapInvoice(invoice));
});

router.post("/invoices/:id/duplicate", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const original = await getInvoiceDetail(id);

  if (!original) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  const [duplicate] = await db
    .insert(invoicesTable)
    .values({
      invoiceNumber: await getNextInvoiceNumber(),
      businessProfileId: original.businessProfileId,
      businessName: original.businessName,
      clientName: original.clientName,
      clientAddress: original.clientAddress,
      periodId: original.periodId,
      invoiceDate: new Date().toISOString().split("T")[0],
      dueDate: original.dueDate,
      serviceDescription: original.serviceDescription,
      notes: original.notes,
      taxRate: original.taxRate?.toString() ?? null,
      subtotal: original.subtotal.toString(),
      taxAmount: original.taxAmount.toString(),
      total: original.total.toString(),
      status: "draft",
    })
    .returning();

  await saveLineItems(duplicate.id, original.lineItems);

  res.status(201).json(await getInvoiceDetail(duplicate.id));
});

export default router;
