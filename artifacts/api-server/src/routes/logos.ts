import { Router, type IRouter } from "express";
import { db, logosTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s, 10);
}

router.get("/logos", async (_req, res): Promise<void> => {
  const logos = await db.select().from(logosTable).orderBy(logosTable.uploadedAt);
  res.json(logos.map((l) => ({ ...l, uploadedAt: l.uploadedAt.toISOString() })));
});

router.post("/logos", async (req, res): Promise<void> => {
  const { filename, mimeType, dataUrl } = req.body;

  if (!filename || !mimeType || !dataUrl) {
    res.status(400).json({ error: "filename, mimeType, dataUrl are required" });
    return;
  }

  const [logo] = await db
    .insert(logosTable)
    .values({ filename, mimeType, dataUrl })
    .returning();

  res.status(201).json({ ...logo, uploadedAt: logo.uploadedAt.toISOString() });
});

router.get("/logos/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [logo] = await db.select().from(logosTable).where(eq(logosTable.id, id)).limit(1);

  if (!logo) {
    res.status(404).json({ error: "Logo not found" });
    return;
  }

  res.json({ ...logo, uploadedAt: logo.uploadedAt.toISOString() });
});

router.delete("/logos/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [logo] = await db.delete(logosTable).where(eq(logosTable.id, id)).returning();

  if (!logo) {
    res.status(404).json({ error: "Logo not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
