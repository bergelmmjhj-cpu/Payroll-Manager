import { Router, type IRouter } from "express";
import { db, workersTable, hotelsTable, payPeriodsTable, invoicesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/dashboard", async (req, res): Promise<void> => {
  const [workerCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workersTable)
    .where(eq(workersTable.isActive, true));

  const [hotelCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(hotelsTable)
    .where(eq(hotelsTable.isActive, true));

  const activePeriods = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(payPeriodsTable)
    .where(sql`status NOT IN ('finalized')`);

  const draftInvoices = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(invoicesTable)
    .where(eq(invoicesTable.status, "draft"));

  const recentPayPeriods = await db
    .select()
    .from(payPeriodsTable)
    .orderBy(desc(payPeriodsTable.createdAt))
    .limit(5);

  res.json({
    totalWorkers: workerCount?.count ?? 0,
    totalHotels: hotelCount?.count ?? 0,
    activePayPeriods: activePeriods[0]?.count ?? 0,
    draftInvoices: draftInvoices[0]?.count ?? 0,
    recentPayPeriods: recentPayPeriods.map((p) => ({
      ...p,
      totalPayroll: p.totalPayroll ? Number(p.totalPayroll) : null,
      totalSubcontractors: p.totalSubcontractors ? Number(p.totalSubcontractors) : null,
      totalGrand: p.totalGrand ? Number(p.totalGrand) : null,
    })),
  });
});

export default router;
