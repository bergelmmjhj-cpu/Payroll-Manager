import { Router, type IRouter } from "express";
import { db, businessProfilesTable, logosTable } from "@workspace/db";
import { eq, ne } from "drizzle-orm";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s, 10);
}

async function enrichProfile(profile: typeof businessProfilesTable.$inferSelect) {
  let logoUrl: string | null = null;
  if (profile.logoId) {
    const [logo] = await db.select().from(logosTable).where(eq(logosTable.id, profile.logoId)).limit(1);
    if (logo) logoUrl = logo.dataUrl;
  }
  return { ...profile, logoUrl };
}

router.get("/business-profiles", async (_req, res): Promise<void> => {
  const profiles = await db.select().from(businessProfilesTable).orderBy(businessProfilesTable.businessName);
  const enriched = await Promise.all(profiles.map(enrichProfile));
  res.json(enriched);
});

router.post("/business-profiles", async (req, res): Promise<void> => {
  const { businessName, address, phone, email, hstNumber, logoId, isDefault, notes } = req.body;

  if (!businessName) {
    res.status(400).json({ error: "businessName is required" });
    return;
  }

  if (isDefault) {
    await db.update(businessProfilesTable).set({ isDefault: false });
  }

  const [profile] = await db
    .insert(businessProfilesTable)
    .values({ businessName, address, phone, email, hstNumber, logoId: logoId || null, isDefault: !!isDefault, notes })
    .returning();

  res.status(201).json(await enrichProfile(profile));
});

router.get("/business-profiles/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [profile] = await db.select().from(businessProfilesTable).where(eq(businessProfilesTable.id, id)).limit(1);

  if (!profile) {
    res.status(404).json({ error: "Business profile not found" });
    return;
  }

  res.json(await enrichProfile(profile));
});

router.patch("/business-profiles/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const body = req.body;

  if (body.isDefault) {
    await db.update(businessProfilesTable).set({ isDefault: false }).where(ne(businessProfilesTable.id, id));
  }

  const update: Partial<typeof businessProfilesTable.$inferInsert> = {};
  const fields = ["businessName", "address", "phone", "email", "hstNumber", "logoId", "isDefault", "notes"] as const;
  for (const f of fields) {
    if (body[f] !== undefined) (update as any)[f] = body[f];
  }

  const [profile] = await db.update(businessProfilesTable).set(update).where(eq(businessProfilesTable.id, id)).returning();

  if (!profile) {
    res.status(404).json({ error: "Business profile not found" });
    return;
  }

  res.json(await enrichProfile(profile));
});

router.delete("/business-profiles/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const [profile] = await db.delete(businessProfilesTable).where(eq(businessProfilesTable.id, id)).returning();

  if (!profile) {
    res.status(404).json({ error: "Business profile not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/business-profiles/:id/set-default", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);

  await db.update(businessProfilesTable).set({ isDefault: false });
  const [profile] = await db
    .update(businessProfilesTable)
    .set({ isDefault: true })
    .where(eq(businessProfilesTable.id, id))
    .returning();

  if (!profile) {
    res.status(404).json({ error: "Business profile not found" });
    return;
  }

  res.json(await enrichProfile(profile));
});

export default router;
