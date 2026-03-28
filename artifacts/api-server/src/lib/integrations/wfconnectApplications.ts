import { db, workersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../logger";

export interface SyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  skippedByReason?: {
    notApproved: number;
    missingId: number;
    missingName: number;
  };
}

/**
 * Expected shape from the WF Connect API applications endpoint.
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

function sanitizeApiKey(rawApiKey?: string): string {
  const value = (rawApiKey ?? "").trim();
  if (!value) return "";

  // Accept accidental formats copied into env vars.
  const withoutBearer = value.replace(/^Bearer\s+/i, "");
  const withoutQuotes = withoutBearer.replace(/^['"]|['"]$/g, "");

  return withoutQuotes.trim();
}

function normalizeWfConnectBaseUrl(rawBase?: string): string {
  const fallback = "https://guide.wfconnect.org";
  const trimmed = (rawBase ?? fallback).trim();
  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");

  // Accept common misconfigurations like .../admin or .../admin/applications.
  return withoutTrailingSlash.replace(
    /\/admin(?:\/applications)?$/i,
    ""
  );
}

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

function isApprovedStatus(status?: string): boolean {
  return (status ?? "").trim().toLowerCase() === "approved";
}

/**
 * Fetches applications from WF Connect and upserts them into the local
 * workers table, keyed by `wfconnect_<id>` in the renderDbId column.
 *
 * Required env: WFCONNECT_API_KEY
 * Optional env: WFCONNECT_API_BASE_URL (default: https://guide.wfconnect.org)
 */
export async function syncWfConnectApplications(): Promise<SyncResult> {
  const rawApiKey = process.env.WFCONNECT_API_KEY;
  const apiKey = sanitizeApiKey(rawApiKey);
  const rawApiBase = process.env.WFCONNECT_API_BASE_URL;
  const apiBase = normalizeWfConnectBaseUrl(rawApiBase);

  if (!apiKey) {
    throw new Error("WFCONNECT_API_KEY is not set");
  }

  if (rawApiKey && rawApiKey !== apiKey) {
    logger.warn(
      {
        rawLength: rawApiKey.length,
        sanitizedLength: apiKey.length,
      },
      "Sanitizing WFCONNECT_API_KEY before request"
    );
  }

  if (rawApiBase && rawApiBase.trim() !== apiBase) {
    logger.warn(
      {
        configuredBaseUrl: rawApiBase,
        normalizedBaseUrl: apiBase,
      },
      "Normalizing WFCONNECT_API_BASE_URL for worker sync"
    );
  }

  const candidateUrls = [
    `${apiBase}/api/admin/applications`,
    `${apiBase}/admin/applications`,
  ];
  let response: Response | undefined;
  let url = candidateUrls[0];

  for (const candidateUrl of candidateUrls) {
    logger.info({ url: candidateUrl }, "Fetching applications from WF Connect");
    const candidateResponse = await fetch(candidateUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Payroll-Manager/worker-sync",
      },
    });

    // Prefer an endpoint that does not return HTML for successful responses.
    if (!candidateResponse.ok) {
      response = candidateResponse;
      url = candidateUrl;
      break;
    }

    const contentType = candidateResponse.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      response = candidateResponse;
      url = candidateUrl;
      break;
    }

    response = candidateResponse;
    url = candidateUrl;
  }

  if (!response) {
    throw new Error("WF Connect API request did not produce a response");
  }

  if (!response.ok) {
    const body = await response.text();

    if (response.status === 401) {
      throw new Error(
        `WF Connect authentication failed (401) from ${url}. Verify WFCONNECT_API_KEY is the raw token value (no Bearer prefix, no quotes/newlines) and has applications-read permissions.`
      );
    }

    throw new Error(
      `WF Connect API responded ${response.status} from ${url}: ${body.slice(0, 300)}`
    );
  }

  const bodyText = await response.text();
  if (!bodyText.trim()) {
    throw new Error("WF Connect API returned an empty response body");
  }

  let raw: WfApiResponse;
  try {
    raw = JSON.parse(bodyText) as WfApiResponse;
  } catch (err) {
    const preview = bodyText.slice(0, 200);
    if (bodyText.trimStart().startsWith("<")) {
      throw new Error(
        "WF Connect API returned HTML instead of JSON. Check WFCONNECT_API_BASE_URL and API path configuration."
      );
    }

    const parseMessage =
      err instanceof Error ? err.message : "Unknown JSON parse error";
    throw new Error(
      `Failed to parse WF Connect API JSON response: ${parseMessage}. Response preview: ${preview}`
    );
  }
  const applications = extractApplications(raw);

  logger.info({ count: applications.length }, "Fetched WF Connect applications");

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  const skippedByReason = {
    notApproved: 0,
    missingId: 0,
    missingName: 0,
  };

  for (const app of applications) {
    if (!isApprovedStatus(app.status)) {
      skipped++;
      skippedByReason.notApproved++;
      continue;
    }

    if (!app.id) {
      skipped++;
      skippedByReason.missingId++;
      continue;
    }

    const name = resolveName(app);
    if (!name) {
      logger.warn({ appId: app.id }, "Skipping application with no resolvable name");
      skipped++;
      skippedByReason.missingName++;
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

  logger.info(
    { inserted, updated, skipped, errors, skippedByReason },
    "WF Connect sync complete"
  );
  return {
    fetched: applications.length,
    inserted,
    updated,
    skipped,
    errors,
    skippedByReason,
  };
}
