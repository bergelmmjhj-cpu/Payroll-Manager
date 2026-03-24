import { Router, type IRouter } from "express";
import pg from "pg";
import { db, workersTable, hotelsTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { detectRegion } from "../lib/regions";
import { syncCrmWorkplaces } from "../lib/integrations/crmWorkplaces";
import { syncWfConnectApplications } from "../lib/integrations/wfconnectApplications";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// GET /api/sync/status — counts of locally stored workers and hotels
// ---------------------------------------------------------------------------
router.get("/sync/status", async (req, res): Promise<void> => {
  try {
    const [{ value: totalWorkers }] = await db
      .select({ value: count() })
      .from(workersTable);
    const [{ value: activeWorkers }] = await db
      .select({ value: count() })
      .from(workersTable)
      .where(eq(workersTable.isActive, true));
    const [{ value: totalHotels }] = await db
      .select({ value: count() })
      .from(hotelsTable);
    const [{ value: activeHotels }] = await db
      .select({ value: count() })
      .from(hotelsTable)
      .where(eq(hotelsTable.isActive, true));

    res.json({
      workers: { total: Number(totalWorkers), active: Number(activeWorkers) },
      hotels: { total: Number(totalHotels), active: Number(activeHotels) },
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get sync status");
    res.status(500).json({ error: "Failed to get sync status" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/sync/workers
//   Default source: WF Connect (WFCONNECT_API_KEY)
//   Legacy source:  ?source=render  (RENDER_DATABASE_URL)
// ---------------------------------------------------------------------------
router.post("/sync/workers", async (req, res): Promise<void> => {
  if (req.query.source === "render") {
    await syncWorkersFromRender(req, res);
    return;
  }

  try {
    const result = await syncWfConnectApplications();
    res.json({
      ...result,
      message: `Synced ${result.fetched} workers from WF Connect (${result.inserted} new, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors)`,
    });
  } catch (err) {
    req.log.error({ err }, "WF Connect worker sync failed");
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/sync/hotels
//   Default source: Weekdays CRM (WEEKDAYS_API_KEY)
//   Legacy source:  ?source=render  (RENDER_DATABASE_URL)
// ---------------------------------------------------------------------------
router.post("/sync/hotels", async (req, res): Promise<void> => {
  if (req.query.source === "render") {
    await syncHotelsFromRender(req, res);
    return;
  }

  try {
    const result = await syncCrmWorkplaces();
    res.json({
      ...result,
      message: `Synced ${result.fetched} hotels from CRM (${result.inserted} new, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors)`,
    });
  } catch (err) {
    req.log.error({ err }, "CRM hotel sync failed");
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// Legacy: sync from RENDER_DATABASE_URL (opt-in via ?source=render)
// ---------------------------------------------------------------------------

function getRenderClient() {
  return new pg.Client({
    connectionString: process.env.RENDER_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
}

async function syncWorkersFromRender(req: any, res: any): Promise<void> {
  const client = getRenderClient();
  try {
    await client.connect();

    const applicantsRes = await client.query(`
      SELECT id::text, full_name, phone,
             address_city, address_province, address_full,
             status, applying_for
      FROM applicants
      WHERE status = 'approved'
      ORDER BY full_name
    `);

    const usersRes = await client.query(`
      SELECT u.id::text, u.full_name, u.email, u.phone, u.worker_roles, u.is_active,
             pp.etransfer_email, pp.payment_method, pp.bank_name, pp.bank_account
      FROM users u
      LEFT JOIN payment_profiles pp ON pp.worker_user_id = u.id
      WHERE u.role = 'worker'
    `);

    await client.end();

    let inserted = 0;
    let updated = 0;

    const allWorkers: Array<{
      renderDbId: string;
      name: string;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
      city?: string | null;
      province?: string | null;
      workerType: string;
      interacEmail?: string | null;
      paymentMethod?: string | null;
      bankName?: string | null;
      bankAccount?: string | null;
    }> = [];

    for (const row of applicantsRes.rows) {
      allWorkers.push({
        renderDbId: `applicant_${row.id}`,
        name: row.full_name || "",
        phone: row.phone || null,
        address: row.address_full || null,
        city: row.address_city || null,
        province: row.address_province || null,
        workerType: "payroll",
      });
    }

    for (const row of usersRes.rows) {
      const existing = allWorkers.find((w) => w.name === row.full_name);
      if (existing) {
        existing.email = row.email || null;
        existing.interacEmail = row.etransfer_email || null;
        existing.paymentMethod = row.payment_method || null;
        existing.bankName = row.bank_name || null;
        existing.bankAccount = row.bank_account || null;
        existing.renderDbId = `user_${row.id}`;
      } else {
        allWorkers.push({
          renderDbId: `user_${row.id}`,
          name: row.full_name || "",
          email: row.email || null,
          phone: row.phone || null,
          workerType: "payroll",
          interacEmail: row.etransfer_email || null,
          paymentMethod: row.payment_method || null,
          bankName: row.bank_name || null,
          bankAccount: row.bank_account || null,
        });
      }
    }

    for (const w of allWorkers) {
      const existing = await db
        .select()
        .from(workersTable)
        .where(eq(workersTable.renderDbId, w.renderDbId))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(workersTable)
          .set({
            name: w.name,
            email: w.email,
            phone: w.phone,
            address: w.address,
            city: w.city,
            province: w.province,
            interacEmail: w.interacEmail,
            paymentMethod: w.paymentMethod,
            bankName: w.bankName,
            bankAccount: w.bankAccount,
          })
          .where(eq(workersTable.renderDbId, w.renderDbId));
        updated++;
      } else {
        await db.insert(workersTable).values({
          ...w,
          workerType: "payroll",
          isActive: true,
        });
        inserted++;
      }
    }

    res.json({
      inserted,
      updated,
      total: allWorkers.length,
      message: `Synced ${allWorkers.length} workers (${inserted} new, ${updated} updated)`,
    });
  } catch (err) {
    req.log.error({ err }, "Worker sync failed");
    if (!client.connection?.stream?.destroyed) {
      await client.end().catch(() => {});
    }
    res.status(500).json({ error: "Sync failed" });
  }
}

async function syncHotelsFromRender(req: any, res: any): Promise<void> {
  const client = getRenderClient();
  try {
    await client.connect();

    const result = await client.query(`
      SELECT id::text, name, address_line1, city, province, is_active
      FROM workplaces
      ORDER BY name
    `);

    await client.end();

    let inserted = 0;
    let updated = 0;

    for (const row of result.rows) {
      const region = detectRegion(row.city, row.province);
      const renderDbId = `workplace_${row.id}`;

      const existing = await db
        .select()
        .from(hotelsTable)
        .where(eq(hotelsTable.renderDbId, renderDbId))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(hotelsTable)
          .set({
            name: row.name,
            address: row.address_line1 || null,
            city: row.city || null,
            province: row.province || null,
            region,
            isActive: row.is_active ?? true,
          })
          .where(eq(hotelsTable.renderDbId, renderDbId));
        updated++;
      } else {
        await db.insert(hotelsTable).values({
          renderDbId,
          name: row.name,
          address: row.address_line1 || null,
          city: row.city || null,
          province: row.province || null,
          region,
          isActive: row.is_active ?? true,
        });
        inserted++;
      }
    }

    res.json({
      inserted,
      updated,
      total: result.rows.length,
      message: `Synced ${result.rows.length} hotels (${inserted} new, ${updated} updated)`,
    });
  } catch (err) {
    req.log.error({ err }, "Hotel sync failed");
    if (!client.connection?.stream?.destroyed) {
      await client.end().catch(() => {});
    }
    res.status(500).json({ error: "Sync failed" });
  }
}

export default router;
