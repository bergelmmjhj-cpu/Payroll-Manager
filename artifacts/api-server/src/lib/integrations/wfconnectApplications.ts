import { db, workersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../logger";

export interface SyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

/**
 * Expected shape from the WF Connect /admin/applications endpoint.
 * Actual field names vary — the integration handles common variants.
 */
interface WfApplication {
  id: string | number;
  full_name?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  province?: string;
  province_code?: string;
  status?: string;
  worker_type?: string;
  applying_for?: string;
  is_active?: boolean;
  active?: boolean;
  notes?: string;
}

type WfApiResponse =
  | WfApplication[]
  | { data: WfApplication[] }
  | { results: WfApplication[] }
  | { applications: WfApplication[] };

function extractApplications(raw: WfApiResponse): WfApplication[] {
  if (Array.isArray(raw)) return raw;
  if ("data" in raw && Array.isArray(raw.data)) return raw.data;
  if ("results" in raw && Array.isArray(raw.results)) return raw.results;
  if ("applications" in raw && Array.isArray(raw.applications)) return raw.applications;
  return [];
}

function resolveName(app: WfApplication): string {
  if (app.full_name) return app.full_name.trim();
  if (app.name) return app.name.trim();
  const first = (app.first_name ?? "").trim();
  const last = (app.last_name ?? "").trim();
  return [first, last].filter(Boolean).join(" ");
}

/**
 * Fetches applications from WF Connect and upserts them into the local
 * workers table, keyed by `wfconnect_<id>` in the renderDbId column.
 *
 * Required env: WFCONNECT_API_KEY
 * Optional env: WFCONNECT_API_BASE_URL (default: https://guide.wfconnect.org)
 */
export async function syncWfConnectApplications(): Promise<SyncResult> {
  const apiKey = process.env.WFCONNECT_API_KEY;
  const apiBase =
    process.env.WFCONNECT_API_BASE_URL ?? "https://guide.wfconnect.org";

  if (!apiKey) {
    throw new Error("WFCONNECT_API_KEY is not set");
  }

  logger.info({ apiBase }, "Fetching applications from WF Connect");

  const response = await fetch(`${apiBase}/admin/applications`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `WF Connect API responded ${response.status}: ${body.slice(0, 300)}`
    );
  }

  const raw = (await response.json()) as WfApiResponse;
  const applications = extractApplications(raw);

  logger.info({ count: applications.length }, "Fetched WF Connect applications");

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const app of applications) {
    if (!app.id) {
      skipped++;
      continue;
    }

    const name = resolveName(app);
    if (!name) {
      logger.warn({ appId: app.id }, "Skipping application with no resolvable name");
      skipped++;
      continue;
    }

    try {
      const renderDbId = `wfconnect_${app.id}`;

      const record = {
        name,
        email: app.email ?? null,
        phone: app.phone ?? null,
        address: app.address ?? null,
        city: app.city ?? null,
        province: app.province ?? app.province_code ?? null,
        workerType: app.worker_type ?? app.applying_for ?? "payroll",
        isActive: app.is_active ?? app.active ?? true,
        notes: app.notes ?? null,
      };

      const existing = await db
        .select({ id: workersTable.id })
        .from(workersTable)
        .where(eq(workersTable.renderDbId, renderDbId))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(workersTable)
          .set(record)
          .where(eq(workersTable.renderDbId, renderDbId));
        updated++;
      } else {
        await db.insert(workersTable).values({ renderDbId, ...record });
        inserted++;
      }
    } catch (err) {
      logger.error({ err, appId: app.id }, "Failed to upsert WF Connect application");
      errors++;
    }
  }

  logger.info({ inserted, updated, skipped, errors }, "WF Connect sync complete");
  return { fetched: applications.length, inserted, updated, skipped, errors };
}
