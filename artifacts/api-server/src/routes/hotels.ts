import { Router, type IRouter } from "express";
import { db, hotelsTable } from "@workspace/db";
import { eq, ilike, or, and } from "drizzle-orm";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s, 10);
}

router.get("/hotels", async (req, res): Promise<void> => {
  const { search, region } = req.query as Record<string, string>;

  const conditions = [];

  if (search) {
    conditions.push(
      or(
        ilike(hotelsTable.name, `%${search}%`),
        ilike(hotelsTable.city, `%${search}%`),
      )!,
    );
  }
  if (region && region !== "all") {
    conditions.push(eq(hotelsTable.region, region));
  }

  const hotels = conditions.length
    ? await db.select().from(hotelsTable).where(and(...conditions)).orderBy(hotelsTable.name)
    : await db.select().from(hotelsTable).orderBy(hotelsTable.name);

  res.json(hotels);
});

router.post("/hotels", async (req, res): Promise<void> => {
  const { name, address, city, province, region, contactName, contactPhone, contactEmail, notes } = req.body;

  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const [hotel] = await db
    .insert(hotelsTable)
    .values({ name, address, city, province, region, contactName, contactPhone, contactEmail, notes, isActive: true })
    .returning();

  res.status(201).json(hotel);
});

router.get("/hotels/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [hotel] = await db.select().from(hotelsTable).where(eq(hotelsTable.id, id)).limit(1);

  if (!hotel) {
    res.status(404).json({ error: "Hotel not found" });
    return;
  }

  res.json(hotel);
});

router.patch("/hotels/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const body = req.body;

  const update: Partial<typeof hotelsTable.$inferInsert> = {};
  const fields = ["name", "address", "city", "province", "region", "contactName", "contactPhone", "contactEmail", "isActive", "notes"] as const;
  for (const f of fields) {
    if (body[f] !== undefined) (update as any)[f] = body[f];
  }

  const [hotel] = await db.update(hotelsTable).set(update).where(eq(hotelsTable.id, id)).returning();

  if (!hotel) {
    res.status(404).json({ error: "Hotel not found" });
    return;
  }

  res.json(hotel);
});

router.delete("/hotels/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [hotel] = await db.delete(hotelsTable).where(eq(hotelsTable.id, id)).returning();

  if (!hotel) {
    res.status(404).json({ error: "Hotel not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
