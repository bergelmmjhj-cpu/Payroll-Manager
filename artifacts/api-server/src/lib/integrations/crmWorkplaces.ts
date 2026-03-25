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
 * Position object from positions array in the CRM response.
 */
interface CrmPosition {
  title?: string;
  rate?: string | number;
  rateType?: string;
  notes?: string;
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
  location?: string;
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
  hiringStatus?: string;
  hiring_status?: string;
  payRate?: string | number;
  pay_rate?: string | number;
  jobPosition?: string;
  job_position?: string;
  positions?: CrmPosition[];
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
 * local hotels table, keyed by `external_id`.
 *
 * Required env: WEEKDAYS_API_KEY
 * Optional env: WEEKDAYS_API_BASE_URL (default: https://weekdays-crm-production.up.railway.app)
 * Optional env: WEEKDAYS_TEAM_ID (default: a532a7d3-e5db-4881-8146-f2522ff9d349)
 */
export async function syncCrmWorkplaces(): Promise<SyncResult> {
  const apiKey = process.env.WEEKDAYS_API_KEY;
  const apiBase =
    process.env.WEEKDAYS_API_BASE_URL ?? "https://weekdays-crm-production.up.railway.app";
  const teamId =
    process.env.WEEKDAYS_TEAM_ID ?? "a532a7d3-e5db-4881-8146-f2522ff9d349";

  if (!apiKey) {
    throw new Error("WEEKDAYS_API_KEY is not set");
  }

  const url = `${apiBase}/api/teams/${teamId}/workplaces`;
  logger.info({ url }, "Fetching workplaces from Weekdays CRM");

  const response = await fetch(url, {
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

  const bodyText = await response.text();
  if (!bodyText.trim()) {
    throw new Error("CRM API returned an empty response body");
  }

  let raw: CrmApiResponse;
  try {
    raw = JSON.parse(bodyText) as CrmApiResponse;
  } catch (err) {
    const preview = bodyText.slice(0, 200);
    if (bodyText.trimStart().startsWith("<")) {
      throw new Error(
        "CRM API returned HTML instead of JSON. Check WEEKDAYS_API_BASE_URL (must be https://weekdays-crm-production.up.railway.app with no trailing /api)."
      );
    }

    const parseMessage =
      err instanceof Error ? err.message : "Unknown JSON parse error";
    throw new Error(
      `Failed to parse CRM API JSON response: ${parseMessage}. Response preview: ${preview}`
    );
  }

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
      const externalId = String(wp.id);
      const city = wp.city ?? wp.location ?? null;
      const province = wp.province ?? wp.province_code ?? null;
      const region = detectRegion(city, province);

      // Handle positions array: extract first position or fall back to top-level fields
      let payRate = "";
      let jobPosition = "";
      const positions = wp.positions ?? [];

      if (positions.length > 0) {
        payRate = String(positions[0].rate ?? "");
        jobPosition = positions[0].title ?? "";
      } else {
        payRate = String(wp.payRate ?? wp.pay_rate ?? "");
        jobPosition = wp.jobPosition ?? wp.job_position ?? "";
      }

      const hiringStatus = wp.hiringStatus ?? wp.hiring_status ?? "open";

      const record = {
        externalId,
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
        hiringStatus,
        payRate,
        jobPosition,
        positions: JSON.stringify(positions),
      };

      const existing = await db
        .select({ id: hotelsTable.id })
        .from(hotelsTable)
        .where(eq(hotelsTable.externalId, externalId))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(hotelsTable)
          .set(record)
          .where(eq(hotelsTable.externalId, externalId));
        updated++;
      } else {
        await db.insert(hotelsTable).values(record);
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
