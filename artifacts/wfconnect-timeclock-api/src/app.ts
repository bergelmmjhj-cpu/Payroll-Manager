import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
  }),
);

app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);

app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok", service: "wfconnect-timeclock-api" });
});

app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/api/timeclock/ping", (_req, res) => {
  res.status(200).json({ message: "wfconnect-timeclock API is running" });
});

export default app;
