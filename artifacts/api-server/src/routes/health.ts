import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import {
  checkWfConnectHealth,
  WfConnectRequestError,
} from "../lib/integrations/wfconnectApplications";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/health/wfconnect", async (_req, res): Promise<void> => {
  try {
    const result = await checkWfConnectHealth();
    res.json({
      status: "ok",
      endpoint: result.endpoint,
      keyPrefix: result.keyPrefix,
      rowCount: result.rowCount,
    });
  } catch (err) {
    if (err instanceof WfConnectRequestError) {
      if (err.code === "invalid_or_revoked_key") {
        res.status(401).json({
          status: "auth_error",
          error: err.message,
          action: "Replace PAYROLL_API_KEY/WFCONNECT_API_KEY with an active key.",
        });
        return;
      }

      if (err.code === "missing_scope") {
        res.status(403).json({
          status: "scope_error",
          error: err.message,
          action: "Grant applications:read scope to the active key.",
        });
        return;
      }

      if (err.code === "timeout" || err.code === "upstream_5xx") {
        res.status(502).json({
          status: "upstream_error",
          error: err.message,
          action: "Retry later or verify WF Connect status.",
        });
        return;
      }
    }

    res.status(500).json({
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
