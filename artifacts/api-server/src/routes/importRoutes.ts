import { Router, type IRouter } from "express";
import { read, utils } from "xlsx";
import { db, workersTable, hotelsTable, payPeriodsTable, timeEntriesTable } from "@workspace/db";
import { eq, ilike } from "drizzle-orm";
import { detectRegion } from "../lib/regions";

const router: IRouter = Router();

const KNOWN_PAYROLL_SHEETS = new Set(["mmj", "mmj payroll", "payroll"]);
const KNOWN_SUBCON_SHEETS = ["subcon 1", "subcon 2", "subcon 3", "subcon 4", "subcon 5", "subcon"];
const KNOWN_INFO_SHEETS = new Set(["draft", "master list", "summary a-z", "tally", "interac details", "for cheque", "gta", "outside gta", "ottawa", "british columbia", "subcon-bc"]);

function detectSheetType(name: string): string {
  const lower = name.toLowerCase().trim();
  if (KNOWN_PAYROLL_SHEETS.has(lower)) return "payroll";
  if (KNOWN_SUBCON_SHEETS.some((s) => lower.includes(s))) return "subcontractor";
  if (lower.includes("gta")) return "region_gta";
  if (lower.includes("ottawa")) return "region_ottawa";
  if (lower.includes("british columbia") || lower === "bc") return "region_bc";
  if (KNOWN_INFO_SHEETS.has(lower)) return "info";
  return "unknown";
}

function parseSheets(workbook: ReturnType<typeof read>) {
  return workbook.SheetNames.map((name) => {
    const ws = workbook.Sheets[name];
    const rows = utils.sheet_to_json(ws, { header: 1, defval: "" }) as string[][];
    return { name, type: detectSheetType(name), rowCount: rows.length, recognized: detectSheetType(name) !== "unknown", rows };
  });
}

router.post("/import/analyze", async (req, res): Promise<void> => {
  const { fileData, fileName } = req.body;

  if (!fileData) {
    res.status(400).json({ error: "fileData is required" });
    return;
  }

  try {
    const buffer = Buffer.from(fileData, "base64");
    const workbook = read(buffer, { type: "buffer" });
    const sheets = parseSheets(workbook);

    let detectedPeriodName: string | null = null;
    let detectedStartDate: string | null = null;
    let detectedEndDate: string | null = null;

    if (fileName) {
      const match = fileName.match(/timesheet[_\s]*([\w\s-]+?)_(\d{13})/i);
      if (match) {
        detectedPeriodName = match[1].replace(/_/g, " ").trim();
      }
    }

    let workerCount = 0;
    let entryCount = 0;

    for (const sheet of sheets) {
      if (sheet.type === "payroll" || sheet.type === "subcontractor") {
        for (let i = 1; i < sheet.rows.length; i++) {
          const row = sheet.rows[i];
          if (row && row[0] && String(row[0]).trim()) {
            workerCount++;
            entryCount++;
          }
        }
      }
    }

    res.json({
      fileName: fileName || "workbook.xlsx",
      sheets: sheets.map(({ name, type, rowCount, recognized }) => ({ name, type, rowCount, recognized })),
      detectedPeriodName,
      detectedStartDate,
      detectedEndDate,
      workerCount,
      entryCount,
    });
  } catch (err) {
    req.log.error({ err }, "Import analyze failed");
    res.status(400).json({ error: "Failed to parse Excel file" });
  }
});

router.post("/import/confirm", async (req, res): Promise<void> => {
  const { fileData, periodId, periodName, startDate, endDate, sheetsToImport, replaceExisting } = req.body;

  if (!fileData) {
    res.status(400).json({ error: "fileData is required" });
    return;
  }

  try {
    const buffer = Buffer.from(fileData, "base64");
    const workbook = read(buffer, { type: "buffer" });
    const sheets = parseSheets(workbook);

    let targetPeriodId = periodId;

    if (!targetPeriodId) {
      const [newPeriod] = await db
        .insert(payPeriodsTable)
        .values({
          name: periodName || "Imported Period",
          startDate: startDate || new Date().toISOString().split("T")[0],
          endDate: endDate || new Date().toISOString().split("T")[0],
          status: "draft",
        })
        .returning();
      targetPeriodId = newPeriod.id;
    }

    if (replaceExisting) {
      await db.delete(timeEntriesTable).where(eq(timeEntriesTable.periodId, targetPeriodId));
    }

    let entriesImported = 0;
    let workersCreated = 0;
    const warnings: string[] = [];

    const selectedSheets = sheets.filter((s) =>
      !sheetsToImport || sheetsToImport.includes(s.name),
    );

    const allHotels = await db.select().from(hotelsTable);

    for (const sheet of selectedSheets) {
      if (sheet.type !== "payroll" && sheet.type !== "subcontractor") continue;
      const entryType = sheet.type === "payroll" ? "payroll" : "subcontractor";

      for (let i = 1; i < sheet.rows.length; i++) {
        const row = sheet.rows[i];
        if (!row || !row[0] || !String(row[0]).trim()) continue;

        const workerName = String(row[0]).trim();
        if (!workerName || workerName.toLowerCase() === "name") continue;

        let workerId: number;
        const existingWorkers = await db
          .select()
          .from(workersTable)
          .where(ilike(workersTable.name, workerName))
          .limit(1);

        if (existingWorkers.length > 0) {
          workerId = existingWorkers[0].id;
        } else {
          const [newWorker] = await db
            .insert(workersTable)
            .values({ name: workerName, workerType: entryType === "payroll" ? "payroll" : "subcontractor", isActive: true })
            .returning();
          workerId = newWorker.id;
          workersCreated++;
        }

        const hotelName = row[1] ? String(row[1]).trim() : null;
        let hotelId: number | null = null;
        if (hotelName) {
          const matchedHotel = allHotels.find((h) => h.name.toLowerCase() === hotelName.toLowerCase());
          if (matchedHotel) hotelId = matchedHotel.id;
        }

        const hours = row[2] ? parseFloat(String(row[2])) : null;
        const rate = row[3] ? parseFloat(String(row[3])) : null;
        const total = row[4] ? parseFloat(String(row[4])) : (hours && rate ? hours * rate : 0);
        const region = hotelId ? (allHotels.find((h) => h.id === hotelId)?.region || null) : null;

        await db.insert(timeEntriesTable).values({
          periodId: targetPeriodId,
          workerId,
          hotelId,
          workerName,
          hotelName,
          entryType,
          hoursWorked: hours?.toString() ?? null,
          ratePerHour: rate?.toString() ?? null,
          totalAmount: (total || 0).toString(),
          paymentStatus: "pending",
          region,
        });
        entriesImported++;
      }
    }

    const [period] = await db.select().from(payPeriodsTable).where(eq(payPeriodsTable.id, targetPeriodId)).limit(1);

    res.json({
      periodId: targetPeriodId,
      periodName: period?.name || periodName || "Imported Period",
      entriesImported,
      workersCreated,
      warnings,
    });
  } catch (err) {
    req.log.error({ err }, "Import confirm failed");
    res.status(400).json({ error: "Import failed" });
  }
});

export default router;
