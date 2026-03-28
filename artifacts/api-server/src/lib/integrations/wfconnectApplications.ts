import { db, workersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../logger";

const DEFAULT_WFCONNECT_BASE_URL = "https://guide.wfconnect.org";
const APPLICATIONS_PATH = "/api/admin/applications";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 500;

type WfConnectFailureCode =
  | "invalid_or_revoked_key"
  | "missing_scope"
  | "timeout"
  | "upstream_5xx"
  | "upstream_error"
  | "invalid_response";

export class WfConnectRequestError extends Error {
  readonly code: WfConnectFailureCode;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(
    code: WfConnectFailureCode,
    message: string,
    options?: { status?: number; retryable?: boolean }
  ) {
    super(message);
    this.name = "WfConnectRequestError";
    this.code = code;
    this.status = options?.status;
    this.retryable = options?.retryable ?? false;
  }
}

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
  payment_method?: string;
  bank_name?: string;
  institution_number?: string | number;
  institution?: string | number;
  bank_institution?: string | number;
  transit_number?: string | number;
  transit?: string | number;
  branch_number?: string | number;
  account_number?: string | number;
  etransfer_email?: string;

  paymentMethod?: string;
  bankName?: string;
  institutionNumber?: string | number;
  transitNumber?: string | number;
  accountNumber?: string | number;
  etransferEmail?: string;

  // allow arbitrary nested payment info objects from the API
  payment_information?: Record<string, unknown>;
  paymentInfo?: Record<string, unknown>;
  paymentProfile?: Record<string, unknown>;
  [key: string]: unknown;
}

type WfApiResponse =
  | WfApplication[]
  | { data: WfApplication[] }
  | { results: WfApplication[] }
  | { applications: WfApplication[] };

interface WfConnectHealthResult {
  ok: boolean;
  endpoint: string;
  keyPrefix: string;
  rowCount: number;
}

function sanitizeApiKey(rawApiKey?: string): string {
  const value = (rawApiKey ?? "").trim();
  if (!value) return "";

  // Accept accidental formats copied into env vars.
  const withoutBearer = value.replace(/^Bearer\s+/i, "");
  const withoutQuotes = withoutBearer.replace(/^['"]|['"]$/g, "");

  return withoutQuotes.trim();
}

function resolveApiKeySource(): { key: string; source: "PAYROLL_API_KEY" | "WFCONNECT_API_KEY" | null } {
  const payrollKey = sanitizeApiKey(process.env.PAYROLL_API_KEY);
  if (payrollKey) {
    return { key: payrollKey, source: "PAYROLL_API_KEY" };
  }

  const wfConnectKey = sanitizeApiKey(process.env.WFCONNECT_API_KEY);
  if (wfConnectKey) {
    return { key: wfConnectKey, source: "WFCONNECT_API_KEY" };
  }

  return { key: "", source: null };
}

function keyPrefix(apiKey: string): string {
  return apiKey.slice(0, 12);
}

function normalizeWfConnectBaseUrl(rawBase?: string): string {
  const fallback = DEFAULT_WFCONNECT_BASE_URL;
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

function normalizeString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return undefined;
}

function getPathValue(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;

  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[segment];
  }, obj);
}

function pickFirstString(obj: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = normalizeString(getPathValue(obj, path));
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Recursively walks `obj` and collects every { path, value } entry whose
 * key matches any of the provided regex patterns. Useful for diagnosing
 * unknown API shapes without having to guess field names.
 */
function deepFindKeys(
  obj: unknown,
  patterns: RegExp[],
  _prefix = ""
): Array<{ path: string; value: unknown }> {
  if (!obj || typeof obj !== "object") return [];
  const results: Array<{ path: string; value: unknown }> = [];
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = _prefix ? `${_prefix}.${key}` : key;
    if (patterns.some((p) => p.test(key))) {
      results.push({ path, value });
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      results.push(...deepFindKeys(value, patterns, path));
    }
  }
  return results;
}

const BANKING_KEY_PATTERNS = [
  /institution/i,
  /transit/i,
  /branch/i,
  /routing/i,
  /bank/i,
  /account/i,
  /payment/i,
  /etransfer/i,
  /interac/i,
];

function normalizePaymentMethod(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const normalized = value.trim().toLowerCase();
  if (["direct deposit", "direct_deposit", "direct-deposit"].includes(normalized)) {
    return "Direct Deposit";
  }

  if (["e-transfer", "etransfer", "e_transfer", "interac"].includes(normalized)) {
    return "E-Transfer";
  }

  return value;
}

interface ParsedPaymentFields {
  paymentMethod?: string;
  bankName?: string;
  institutionNumber?: string;
  transitNumber?: string;
  accountNumber?: string;
  bankAccount?: string;
  interacEmail?: string;
}

function extractPaymentFields(app: WfApplication): ParsedPaymentFields {
  const paymentMethodRaw = pickFirstString(app, [
    "payment_method",
    "paymentMethod",
    "payment_information.payment_method",
    "payment_information.paymentMethod",
    "payment_information.method",
    "paymentInfo.paymentMethod",
    "paymentProfile.paymentMethod",
  ]);

  const bankName = pickFirstString(app, [
    "bank_name",
    "bankName",
    "payment_information.bank_name",
    "payment_information.bankName",
    "paymentInfo.bankName",
    "paymentProfile.bankName",
  ]);

  const institutionNumber = pickFirstString(app, [
    "institution_number",
    "institution",
    "bank_institution",
    "institutionNumber",
    "payment_information.institution_number",
    "payment_information.institution",
    "payment_information.bank_institution",
    "payment_information.institutionNumber",
    "paymentInfo.institutionNumber",
    "paymentInfo.institution_number",
    "paymentInfo.institution",
    "paymentProfile.institutionNumber",
    "paymentProfile.institution_number",
    "paymentProfile.institution",
  ]);

  const transitNumber = pickFirstString(app, [
    "transit_number",
    "transit",
    "branch_number",
    "transitNumber",
    "payment_information.transit_number",
    "payment_information.transit",
    "payment_information.branch_number",
    "payment_information.transitNumber",
    "paymentInfo.transitNumber",
    "paymentInfo.transit_number",
    "paymentInfo.transit",
    "paymentProfile.transitNumber",
    "paymentProfile.transit_number",
    "paymentProfile.transit",
  ]);

  const accountNumber = pickFirstString(app, [
    "account_number",
    "accountNumber",
    "payment_information.account_number",
    "payment_information.accountNumber",
    "paymentInfo.accountNumber",
    "paymentProfile.accountNumber",
    "bank_account",
    "bankAccount",
  ]);

  const interacEmail = pickFirstString(app, [
    "etransfer_email",
    "etransferEmail",
    "e_transfer_email",
    "interac_email",
    "interacEmail",
    "payment_information.etransfer_email",
    "payment_information.interac_email",
    "paymentInfo.etransferEmail",
    "paymentInfo.interacEmail",
    "paymentProfile.etransferEmail",
    "paymentProfile.interacEmail",
  ]);

  return {
    paymentMethod: normalizePaymentMethod(paymentMethodRaw),
    bankName,
    institutionNumber,
    transitNumber,
    accountNumber,
    bankAccount: accountNumber,
    interacEmail,
  };
}

function computeBackoffDelayMs(attempt: number): number {
  const exponential = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * 300);
  return exponential + jitter;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchApplications(apiBase: string, apiKey: string): Promise<Response> {
  const endpoint = `${apiBase}${APPLICATIONS_PATH}`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      logger.info({ endpoint, attempt, maxAttempts: MAX_ATTEMPTS }, "Fetching applications from WF Connect");
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "Payroll-Manager/worker-sync",
        },
        signal: controller.signal,
      });

      if (response.status === 401) {
        throw new WfConnectRequestError(
          "invalid_or_revoked_key",
          "WF Connect key is invalid or revoked (401). Replace PAYROLL_API_KEY/WFCONNECT_API_KEY.",
          { status: 401, retryable: false }
        );
      }

      if (response.status === 403) {
        throw new WfConnectRequestError(
          "missing_scope",
          "WF Connect key is missing required scope applications:read (403).",
          { status: 403, retryable: false }
        );
      }

      if (response.status >= 500) {
        const body = await response.text();
        if (attempt < MAX_ATTEMPTS) {
          const delayMs = computeBackoffDelayMs(attempt);
          logger.warn(
            { endpoint, status: response.status, attempt, delayMs },
            "WF Connect upstream 5xx, retrying with backoff"
          );
          await sleep(delayMs);
          continue;
        }

        throw new WfConnectRequestError(
          "upstream_5xx",
          `WF Connect API responded ${response.status}: ${body.slice(0, 300)}`,
          { status: response.status, retryable: true }
        );
      }

      if (!response.ok) {
        const body = await response.text();
        throw new WfConnectRequestError(
          "upstream_error",
          `WF Connect API responded ${response.status}: ${body.slice(0, 300)}`,
          { status: response.status, retryable: false }
        );
      }

      return response;
    } catch (err) {
      if (err instanceof WfConnectRequestError) {
        throw err;
      }

      const isTimeout = err instanceof Error && err.name === "AbortError";
      if (isTimeout && attempt < MAX_ATTEMPTS) {
        const delayMs = computeBackoffDelayMs(attempt);
        logger.warn(
          { endpoint, attempt, delayMs, timeoutMs: REQUEST_TIMEOUT_MS },
          "WF Connect request timed out, retrying"
        );
        await sleep(delayMs);
        continue;
      }

      if (isTimeout) {
        throw new WfConnectRequestError(
          "timeout",
          `WF Connect request timed out after ${REQUEST_TIMEOUT_MS}ms.`,
          { retryable: true }
        );
      }

      const message = err instanceof Error ? err.message : String(err);
      throw new WfConnectRequestError(
        "upstream_error",
        `WF Connect request failed: ${message}`,
        { retryable: false }
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new WfConnectRequestError(
    "upstream_error",
    "WF Connect request failed without response.",
    { retryable: false }
  );
}

async function fetchAndParseApplications(
  apiBase: string,
  apiKey: string
): Promise<{ endpoint: string; applications: WfApplication[] }> {
  const endpoint = `${apiBase}${APPLICATIONS_PATH}`;
  const response = await fetchApplications(apiBase, apiKey);
  const bodyText = await response.text();

  if (!bodyText.trim()) {
    throw new WfConnectRequestError(
      "invalid_response",
      "WF Connect API returned an empty response body.",
      { retryable: false }
    );
  }

  let raw: WfApiResponse;
  try {
    raw = JSON.parse(bodyText) as WfApiResponse;
  } catch (err) {
    const preview = bodyText.slice(0, 200);
    if (bodyText.trimStart().startsWith("<")) {
      throw new WfConnectRequestError(
        "invalid_response",
        "WF Connect API returned HTML instead of JSON. Check WFCONNECT_API_BASE_URL.",
        { retryable: false }
      );
    }

    const parseMessage = err instanceof Error ? err.message : "Unknown JSON parse error";
    throw new WfConnectRequestError(
      "invalid_response",
      `Failed to parse WF Connect API JSON response: ${parseMessage}. Response preview: ${preview}`,
      { retryable: false }
    );
  }

  return {
    endpoint,
    applications: extractApplications(raw),
  };
}

export async function checkWfConnectHealth(): Promise<WfConnectHealthResult> {
  const { key: apiKey, source } = resolveApiKeySource();
  const rawApiBase = process.env.WFCONNECT_API_BASE_URL;
  const apiBase = normalizeWfConnectBaseUrl(rawApiBase);

  if (!apiKey || !source) {
    throw new WfConnectRequestError(
      "invalid_or_revoked_key",
      "Missing API key. Set PAYROLL_API_KEY or WFCONNECT_API_KEY.",
      { retryable: false }
    );
  }

  const prefix = keyPrefix(apiKey);
  logger.info({ keySource: source, keyPrefix: prefix, apiBase }, "Running WF Connect health check");

  const { endpoint, applications } = await fetchAndParseApplications(apiBase, apiKey);

  return {
    ok: true,
    endpoint,
    keyPrefix: prefix,
    rowCount: applications.length,
  };
}

/**
 * Fetches applications from WF Connect and upserts them into the local
 * workers table, keyed by `wfconnect_<id>` in the renderDbId column.
 *
 * Required env: PAYROLL_API_KEY (preferred) or WFCONNECT_API_KEY (fallback)
 * Optional env: WFCONNECT_API_BASE_URL (default: https://guide.wfconnect.org)
 */
export async function syncWfConnectApplications(): Promise<SyncResult> {
  const { key: apiKey, source: keySource } = resolveApiKeySource();
  const rawApiBase = process.env.WFCONNECT_API_BASE_URL;
  const apiBase = normalizeWfConnectBaseUrl(rawApiBase);
  const prefix = keyPrefix(apiKey);

  if (!apiKey) {
    throw new WfConnectRequestError(
      "invalid_or_revoked_key",
      "Missing API key. Set PAYROLL_API_KEY or WFCONNECT_API_KEY.",
      { retryable: false }
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

  logger.info(
    { keySource: keySource ?? "unknown", keyPrefix: prefix, apiBase },
    "Starting WF Connect worker sync"
  );

  const { applications } = await fetchAndParseApplications(apiBase, apiKey);

  logger.info({ count: applications.length, keyPrefix: prefix }, "Fetched WF Connect applications");

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

      const topLevelKeys = Object.keys(app as Record<string, unknown>);
      const bankingFields = deepFindKeys(app, BANKING_KEY_PATTERNS);

      logger.info(
        {
          appId: app.id,
          topLevelKeys,
          bankingFields,
          rawPayload: app,
        },
        "[RAW_PAYLOAD] WF Connect application — check topLevelKeys and bankingFields to identify institution/transit field names"
      );

      const payment = extractPaymentFields(app);

      logger.info(
        {
          appId: app.id,
          paymentMethod: payment.paymentMethod,
          bankName: payment.bankName,
          institutionNumber: payment.institutionNumber,
          transitNumber: payment.transitNumber,
          accountNumber: payment.accountNumber,
          interacEmail: payment.interacEmail,
        },
        "[EXTRACTED_PAYMENT] Mapped payment fields for WF Connect application"
      );

      const baseRecord = {
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
        .select()
        .from(workersTable)
        .where(eq(workersTable.renderDbId, renderDbId))
        .limit(1);

      if (existing.length > 0) {
        const current = existing[0];

        const paymentRecord = {
          paymentMethod: payment.paymentMethod ?? current.paymentMethod ?? null,
          bankName: payment.bankName ?? current.bankName ?? null,
          institutionNumber: payment.institutionNumber ?? current.institutionNumber ?? null,
          transitNumber: payment.transitNumber ?? current.transitNumber ?? null,
          accountNumber: payment.accountNumber ?? current.accountNumber ?? null,
          bankAccount: payment.bankAccount ?? current.bankAccount ?? null,
          interacEmail: payment.interacEmail ?? current.interacEmail ?? null,
        };

        await db
          .update(workersTable)
          .set({ ...baseRecord, ...paymentRecord })
          .where(eq(workersTable.renderDbId, renderDbId));
        logger.info(
          {
            appId: app.id,
            renderDbId,
            institutionNumber: paymentRecord.institutionNumber,
            transitNumber: paymentRecord.transitNumber,
            bankName: paymentRecord.bankName,
            accountNumber: paymentRecord.accountNumber,
            interacEmail: paymentRecord.interacEmail,
          },
          "[DB_SAVED] Updated existing worker payment fields"
        );
        updated++;
      } else {
        const insertRecord = {
          renderDbId,
          ...baseRecord,
          paymentMethod: payment.paymentMethod ?? null,
          bankName: payment.bankName ?? null,
          institutionNumber: payment.institutionNumber ?? null,
          transitNumber: payment.transitNumber ?? null,
          accountNumber: payment.accountNumber ?? null,
          bankAccount: payment.bankAccount ?? null,
          interacEmail: payment.interacEmail ?? null,
        };
        await db.insert(workersTable).values(insertRecord);
        logger.info(
          {
            appId: app.id,
            renderDbId,
            institutionNumber: insertRecord.institutionNumber,
            transitNumber: insertRecord.transitNumber,
            bankName: insertRecord.bankName,
            accountNumber: insertRecord.accountNumber,
            interacEmail: insertRecord.interacEmail,
          },
          "[DB_SAVED] Inserted new worker payment fields"
        );
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

/**
 * Diagnostic function: Fetches one sample application from WFConnect and returns
 * detailed mapping information to help debug missing fields like institution_number/transit_number.
 *
 * Returns:
 *   - Raw first approved application from WFConnect API
 *   - All banking-related fields found by deepFindKeys
 *   - Extracted payment fields after mapping
 *   - Comparison showing what was found vs. what's expected
 */
export async function diagnosticWfConnectSample(): Promise<{
  status: "ok" | "error";
  message: string;
  sample?: {
    appId: string | number;
    topLevelKeys: string[];
    bankingFieldsFound: Array<{ path: string; value: unknown }>;
    extracted: {
      paymentMethod?: string;
      bankName?: string;
      institutionNumber?: string;
      transitNumber?: string;
      accountNumber?: string;
      interacEmail?: string;
    };
    summary: {
      institutionNumberFound: boolean;
      transitNumberFound: boolean;
      accountNumberFound: boolean;
      bankNameFound: boolean;
    };
  };
  error?: string;
}> {
  try {
    const { key: apiKey, source: keySource } = resolveApiKeySource();
    const rawApiBase = process.env.WFCONNECT_API_BASE_URL;
    const apiBase = normalizeWfConnectBaseUrl(rawApiBase);

    if (!apiKey) {
      return {
        status: "error",
        message: "No API key configured (PAYROLL_API_KEY or WFCONNECT_API_KEY)",
        error: "Missing credentials",
      };
    }

    const { applications } = await fetchAndParseApplications(apiBase, apiKey);

    // Find first approved application
    const approved = applications.find(
      (app) => isApprovedStatus(app.status) && app.id && resolveName(app)
    );

    if (!approved) {
      return {
        status: "ok",
        message: `No approved applications found (fetched ${applications.length} total)`,
      };
    }

    const topLevelKeys = Object.keys(approved as Record<string, unknown>);
    const bankingFieldsFound = deepFindKeys(approved, BANKING_KEY_PATTERNS);
    const extracted = extractPaymentFields(approved);

    return {
      status: "ok",
      message: "Sample application diagnostic data retrieved successfully",
      sample: {
        appId: approved.id,
        topLevelKeys,
        bankingFieldsFound,
        extracted,
        summary: {
          institutionNumberFound: !!extracted.institutionNumber,
          transitNumberFound: !!extracted.transitNumber,
          accountNumberFound: !!extracted.accountNumber,
          bankNameFound: !!extracted.bankName,
        },
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      message: "Failed to fetch diagnostic data",
      error: message,
    };
  }
}
