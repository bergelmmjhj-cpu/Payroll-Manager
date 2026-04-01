import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import syncRouter from "./sync";
import dashboardRouter from "./dashboard";
import workersRouter from "./workers";
import hotelsRouter from "./hotels";
import payPeriodsRouter from "./payPeriods";
import importRouter from "./importRoutes";
import businessProfilesRouter from "./businessProfiles";
import logosRouter from "./logos";
import invoicesRouter from "./invoices";
import timelogRouter from "./timelog";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(syncRouter);
router.use(dashboardRouter);
router.use(workersRouter);
router.use(hotelsRouter);
router.use(payPeriodsRouter);
router.use(importRouter);
router.use(businessProfilesRouter);
router.use(logosRouter);
router.use(invoicesRouter);
router.use(timelogRouter);

export default router;
