import { db, hotelsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { detectRegion } from "../regions";
import { logger } from "../logger";

export interface SyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

/**
 * Expected shape from the Weekdays CRM workplaces endpoint.
 * Actual field names vary — the integration handles common variants.
 */
interface CrmWorkplace {
  id: string | number;
  name: string;
  address?: string;
  address_line1?: string;
  city?: string;
  province?: string;
  province_code?: string;
  is_active?: boolean;
  active?: boolean;
  contact_name?: string;
  contact_person?: string;
  contact_phone?: string;
  phone?: string;
  contact_email?: string;
  email?: string;
  notes?: string;
}

type CrmApiResponse =
  | CrmWorkplace[]
  | { data: CrmWorkplace[] }
  | { results: CrmWorkplace[] }
  | { workplaces: CrmWorkplace[] };

function extractWorkplaces(raw: CrmApiResponse): CrmWorkplace[] {
  if (Array.isArray(raw)) return raw;
  if ("data" in raw && Array.isArray(raw.data)) return raw.data;
  if ("results" in raw && Array.isArray(raw.results)) return raw.results;
  if ("workplaces" in raw && Array.isArray(raw.workplaces)) return raw.workplaces;
  return [];
}

/**
 * Fetches workplaces from the Weekdays CRM API and upserts them into the
 * local hotels table, keyed by `crm_<id>` in the renderDbId column.
 *
 * Required env: WEEKDAYS_API_KEY
 * Optional env: WEEKDAYS_API_BASE_URL (default: https://app.weekdays.io/api)
 */
export async function syncCrmWorkplaces(): Promise<SyncResult> {
  const apiKey = process.env.WEEKDAYS_API_KEY;
  const apiBase =
    process.env.WEEKDAYS_API_BASE_URL ?? "https://app.weekdays.io/api";

  if (!apiKey) {
    throw new Error("WEEKDAYS_API_KEY is not set");
  }

  logger.info({ apiBase }, "Fetching workplaces from Weekdays CRM");

  const response = await fetch(`${apiBase}/workplaces`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `CRM API responded ${response.status}: ${body.slice(0, 300)}`
    );
  }

  const raw = (await response.json()) as CrmApiResponse;
  const workplaces = extractWorkplaces(raw);

  logger.info({ count: workplaces.length }, "Fetched CRM workplaces");

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const wp of workplaces) {
    if (!wp.id || !wp.name) {
      skipped++;
      continue;
    }

    try {
      const renderDbId = `crm_${wp.id}`;
      const city = wp.city ?? null;
      const province = wp.province ?? wp.province_code ?? null;
      const region = detectRegion(city, province);

      const record = {
        name: wp.name,
        address: wp.address_line1 ?? wp.address ?? null,
        city,
        province,
        region,
        contactName: wp.contact_name ?? wp.contact_person ?? null,
        contactPhone: wp.contact_phone ?? wp.phone ?? null,
        contactEmail: wp.contact_email ?? wp.email ?? null,
        isActive: wp.is_active ?? wp.active ?? true,
        notes: wp.notes ?? null,
      };

      const existing = await db
        .select({ id: hotelsTable.id })
        .from(hotelsTable)
        .where(eq(hotelsTable.renderDbId, renderDbId))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(hotelsTable)
          .set(record)
          .where(eq(hotelsTable.renderDbId, renderDbId));
        updated++;
      } else {
        await db.insert(hotelsTable).values({ renderDbId, ...record });
        inserted++;
      }
    } catch (err) {
      logger.error({ err, workplaceId: wp.id }, "Failed to upsert CRM workplace");
      errors++;
    }
  }

  logger.info({ inserted, updated, skipped, errors }, "CRM workplace sync complete");
  return { fetched: workplaces.length, inserted, updated, skipped, errors };
}
