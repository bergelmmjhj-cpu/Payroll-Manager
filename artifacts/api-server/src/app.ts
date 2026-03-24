import express, { type Express } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import router from "./routes";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import "./lib/passport";

const PgSession = connectPgSimple(session);
const isProduction = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET;

if (isProduction && !sessionSecret) {
  throw new Error(
    "SESSION_SECRET must be set when NODE_ENV=production.",
  );
}

const app: Express = express();
const payrollDistDir = path.resolve(process.cwd(), "artifacts/payroll/dist/public");
const payrollIndexFile = path.join(payrollDistDir, "index.html");
const hasPayrollAssets = existsSync(payrollIndexFile);

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "sessions",
      createTableIfMissing: false,
    }),
    secret: sessionSecret ?? "mmj-payroll-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction ? "auto" : false,
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    },
  }),
);

app.use(passport.initialize());
app.use(passport.session());

app.use("/api", router);

if (hasPayrollAssets) {
  app.use(express.static(payrollDistDir, { index: false }));

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    if (req.path.startsWith("/api")) {
      next();
      return;
    }

    res.sendFile(payrollIndexFile);
  });
} else {
  logger.warn(
    { payrollDistDir },
    "Payroll assets not found; static frontend serving disabled",
  );
}

export default app;
