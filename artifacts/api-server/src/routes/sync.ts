import { Router, type IRouter } from "express";
import pg from "pg";
import { db, workersTable, hotelsTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { detectRegion } from "../lib/regions";
import { syncCrmWorkplaces } from "../lib/integrations/crmWorkplaces";
import {
  syncWfConnectApplications,
  diagnosticWfConnectSample,
  WfConnectRequestError,
} from "../lib/integrations/wfconnectApplications";

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
// GET /api/sync/diagnostic — debug why institution/transit numbers not syncing
// ---------------------------------------------------------------------------
router.get("/sync/diagnostic", async (req, res): Promise<void> => {
  try {
    const result = await diagnosticWfConnectSample();
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get diagnostic data");
    res.status(500).json({
      status: "error",
      message: "Failed to run diagnostic",
      error: String(err),
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/sync/workers
//   Default source: WF Connect (PAYROLL_API_KEY or WFCONNECT_API_KEY)
//   Fallback source: Render DB when both keys are missing
//   Force legacy source: ?source=render (RENDER_DATABASE_URL)
// ---------------------------------------------------------------------------
router.post("/sync/workers", async (req, res): Promise<void> => {
  const forceRender = req.query.source === "render";
  const hasWfConnectKey = Boolean(
    process.env.PAYROLL_API_KEY || process.env.WFCONNECT_API_KEY
  );
  const hasRenderSource = Boolean(process.env.RENDER_DATABASE_URL);

  if (forceRender || !hasWfConnectKey) {
    if (!hasRenderSource) {
      res.status(400).json({
        error:
          "No worker sync source configured. Set PAYROLL_API_KEY (or WFCONNECT_API_KEY) or RENDER_DATABASE_URL.",
      });
      return;
    }

    if (!forceRender && !hasWfConnectKey) {
      req.log.warn(
        "PAYROLL_API_KEY/WFCONNECT_API_KEY not set; using legacy Render worker sync fallback"
      );
    }

    await syncWorkersFromRender(req, res);
    return;
  }

  try {
    const result = await syncWfConnectApplications();
    const skippedReasonMessage = result.skippedByReason
      ? ` (not approved: ${result.skippedByReason.notApproved}, missing id: ${result.skippedByReason.missingId}, missing name: ${result.skippedByReason.missingName})`
      : "";
    res.json({
      ...result,
      message: `Processed ${result.fetched} WF Connect applications (approved imports only): ${result.inserted} new, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors${skippedReasonMessage}`,
    });
  } catch (err) {
    if (err instanceof WfConnectRequestError) {
      if (err.code === "invalid_or_revoked_key") {
        req.log.error({ err }, "WF Connect key invalid or revoked");
        res.status(401).json({
          error: err.message,
          action: "Replace PAYROLL_API_KEY/WFCONNECT_API_KEY with an active key.",
        });
        return;
      }

      if (err.code === "missing_scope") {
        req.log.error({ err }, "WF Connect key missing required scope");
        res.status(403).json({
          error: err.message,
          action: "Grant applications:read scope to the active key.",
        });
        return;
      }

      if (err.code === "timeout" || err.code === "upstream_5xx") {
        req.log.error({ err }, "WF Connect transient upstream failure");
        res.status(502).json({
          error: err.message,
          action: "Retry later. If persistent, check WF Connect uptime.",
        });
        return;
      }
    }

    req.log.error({ err }, "WF Connect worker sync failed");
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/sync/hotels
//   Default source: Weekdays CRM (WEEKDAYS_API_KEY)
//   Fallback source: Render DB when WEEKDAYS_API_KEY is missing
//   Force legacy source: ?source=render (RENDER_DATABASE_URL)
// ---------------------------------------------------------------------------
router.post("/sync/hotels", async (req, res): Promise<void> => {
  const forceRender = req.query.source === "render";
  const hasCrmKey = Boolean(process.env.WEEKDAYS_API_KEY);
  const hasRenderSource = Boolean(process.env.RENDER_DATABASE_URL);

  if (forceRender || !hasCrmKey) {
    if (!hasRenderSource) {
      res.status(400).json({
        error:
          "No hotel sync source configured. Set WEEKDAYS_API_KEY or RENDER_DATABASE_URL.",
      });
      return;
    }

    if (!forceRender && !hasCrmKey) {
      req.log.warn(
        "WEEKDAYS_API_KEY not set; using legacy Render hotel sync fallback"
      );
    }

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

/**
 * Helper to extract banking fields from a payment_profile JSON object.
 * Tries multiple key variants to handle different API/schema naming conventions.
 */
function extractBankingFieldsFromProfile(profile: Record<string, any> | null | undefined): {
  institutionNumber?: string | null;
  transitNumber?: string | null;
  accountNumber?: string | null;
} {
  if (!profile || typeof profile !== "object") {
    return { institutionNumber: null, transitNumber: null, accountNumber: null };
  }

  const result = {
    institutionNumber: null as string | null,
    transitNumber: null as string | null,
    accountNumber: null as string | null,
  };

  // Helper to get a value from the profile, trying multiple key variants
  function getFirstMatch(keys: string[]): string | null {
    for (const key of keys) {
      const value = profile![key];
      if (value && typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  result.institutionNumber = getFirstMatch([
    "institution_number",
    "institution",
    "bank_institution",
    "institutionNumber",
  ]);

  result.transitNumber = getFirstMatch([
    "transit_number",
    "transit",
    "bank_transit",
    "branch_number",
    "transitNumber",
  ]);

  result.accountNumber = getFirstMatch([
    "account_number",
    "accountNumber",
    "bank_account",
    "bankAccount",
  ]);

  return result;
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
             pp.etransfer_email, pp.payment_method, pp.bank_name, pp.bank_account,
             to_jsonb(pp) AS payment_profile
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
      institutionNumber?: string | null;
      transitNumber?: string | null;
      accountNumber?: string | null;
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
      const bankingFields = extractBankingFieldsFromProfile(row.payment_profile);
      const existing = allWorkers.find((w) => w.name === row.full_name);
      if (existing) {
        existing.email = row.email || null;
        existing.interacEmail = row.etransfer_email || null;
        existing.paymentMethod = row.payment_method || null;
        existing.bankName = row.bank_name || null;
        existing.bankAccount = row.bank_account || null;
        existing.institutionNumber = bankingFields.institutionNumber || null;
        existing.transitNumber = bankingFields.transitNumber || null;
        existing.accountNumber = bankingFields.accountNumber || null;
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
          institutionNumber: bankingFields.institutionNumber || null,
          transitNumber: bankingFields.transitNumber || null,
          accountNumber: bankingFields.accountNumber || null,
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
            institutionNumber: w.institutionNumber,
            transitNumber: w.transitNumber,
            accountNumber: w.accountNumber,
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
