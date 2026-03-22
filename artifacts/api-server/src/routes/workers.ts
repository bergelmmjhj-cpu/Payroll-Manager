import { Router, type IRouter } from "express";
import { db, workersTable } from "@workspace/db";
import { eq, ilike, or, and } from "drizzle-orm";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s, 10);
}

function mapWorker(w: typeof workersTable.$inferSelect) {
  return { ...w };
}

router.get("/workers", async (req, res): Promise<void> => {
  const { search, type, region } = req.query as Record<string, string>;

  const conditions = [];

  if (search) {
    conditions.push(
      or(
        ilike(workersTable.name, `%${search}%`),
        ilike(workersTable.email, `%${search}%`),
        ilike(workersTable.phone, `%${search}%`),
      )!,
    );
  }
  if (type && type !== "all") {
    conditions.push(eq(workersTable.workerType, type));
  }
  if (region) {
    conditions.push(eq(workersTable.province, region));
  }

  const workers = conditions.length
    ? await db.select().from(workersTable).where(and(...conditions)).orderBy(workersTable.name)
    : await db.select().from(workersTable).orderBy(workersTable.name);

  res.json(workers.map(mapWorker));
});

router.post("/workers", async (req, res): Promise<void> => {
  const { name, email, phone, address, city, province, workerType, interacEmail, paymentMethod, bankName, bankAccount, sinNumber, notes } = req.body;

  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const [worker] = await db
    .insert(workersTable)
    .values({ name, email, phone, address, city, province, workerType: workerType || "payroll", interacEmail, paymentMethod, bankName, bankAccount, sinNumber, notes, isActive: true })
    .returning();

  res.status(201).json(mapWorker(worker));
});

router.get("/workers/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [worker] = await db.select().from(workersTable).where(eq(workersTable.id, id)).limit(1);

  if (!worker) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }

  res.json(mapWorker(worker));
});

router.patch("/workers/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const { name, email, phone, address, city, province, workerType, isActive, interacEmail, paymentMethod, bankName, bankAccount, sinNumber, notes } = req.body;

  const update: Partial<typeof workersTable.$inferInsert> = {};
  if (name !== undefined) update.name = name;
  if (email !== undefined) update.email = email;
  if (phone !== undefined) update.phone = phone;
  if (address !== undefined) update.address = address;
  if (city !== undefined) update.city = city;
  if (province !== undefined) update.province = province;
  if (workerType !== undefined) update.workerType = workerType;
  if (isActive !== undefined) update.isActive = isActive;
  if (interacEmail !== undefined) update.interacEmail = interacEmail;
  if (paymentMethod !== undefined) update.paymentMethod = paymentMethod;
  if (bankName !== undefined) update.bankName = bankName;
  if (bankAccount !== undefined) update.bankAccount = bankAccount;
  if (sinNumber !== undefined) update.sinNumber = sinNumber;
  if (notes !== undefined) update.notes = notes;

  const [worker] = await db.update(workersTable).set(update).where(eq(workersTable.id, id)).returning();

  if (!worker) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }

  res.json(mapWorker(worker));
});

router.delete("/workers/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [worker] = await db.delete(workersTable).where(eq(workersTable.id, id)).returning();

  if (!worker) {
    res.status(404).json({ error: "Worker not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
