import { useEffect, useRef, useState } from "react";
import {
  getListHotelWorkerRatesQueryKey,
  getListWorkersQueryKey,
  useCreateWorker,
  useListHotelWorkerRates,
  useSaveHotelSectionEntries,
  type BulkSaveHotelEntriesBody,
  type CreateWorkerBody,
  type Hotel,
  type HotelPosition,
  type TimeEntry,
  type Worker,
  type WorkerHotelRate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, Input, Label } from "@/components/ui";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, formatCurrency } from "@/lib/utils";
import { Check, Plus, Search, Trash2, UserPlus } from "lucide-react";

export type PayPeriodHotelSection = {
  id: number;
  periodId: number;
  hotelId: number;
  hotelName: string;
  region?: string | null;
  notes?: string | null;
};

type HotelHoursSheetProps = {
  open: boolean;
  periodId: number;
  periodStartDate: string;
  locked: boolean;
  section: PayPeriodHotelSection | null;
  entries: TimeEntry[];
  workers: Worker[];
  hotels: Hotel[];
  onClose: () => void;
  onSaved: () => Promise<void>;
};

type RowDraft = {
  key: string;
  id?: number;
  workerId: string;
  role: string;
  entryType: "payroll" | "subcontractor";
  workDate: string;
  regularHours: string;
  overtimeHours: string;
  otherHours: string;
  ratePerHour: string;
  notes: string;
  rateOverridden: boolean;
};

type QuickAddWorkerState = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  role: string;
  workerType: "payroll" | "subcontractor";
  defaultRate: string;
};

const COMPACT_INPUT_CLASS =
  "min-h-0 h-9 rounded-lg border border-border px-2 py-1 text-sm shadow-none focus-visible:ring-2 focus-visible:ring-primary/15";

const GRID_COLUMNS = ["worker", "role", "regularHours", "overtimeHours", "otherHours", "ratePerHour", "notes"] as const;

function makeRowKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRole(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function resolveHotelPositionRate(hotel: Hotel | undefined, role: string): number | null {
  if (!hotel) return null;

  const normalizedRole = normalizeRole(role);
  const positions = Array.isArray(hotel.positions) ? hotel.positions : [];

  if (normalizedRole) {
    const match = positions.find((position: HotelPosition) => normalizeRole(position.title ?? null) === normalizedRole);
    const exactRate = toNumberOrNull(match?.rate as string | number | null | undefined);
    if (exactRate != null) return exactRate;
  }

  const firstRate = toNumberOrNull(positions[0]?.rate as string | number | null | undefined);
  if (firstRate != null) return firstRate;

  return toNumberOrNull(hotel.payRate);
}

function computeRowHours(row: RowDraft): number {
  return (toNumberOrNull(row.regularHours) ?? 0) + (toNumberOrNull(row.overtimeHours) ?? 0) + (toNumberOrNull(row.otherHours) ?? 0);
}

function computeRowPay(row: RowDraft): number {
  return computeRowHours(row) * (toNumberOrNull(row.ratePerHour) ?? 0);
}

function hasRowContent(row: RowDraft): boolean {
  return Boolean(
    row.workerId ||
      row.role.trim() ||
      row.regularHours.trim() ||
      row.overtimeHours.trim() ||
      row.otherHours.trim() ||
      row.ratePerHour.trim() ||
      row.notes.trim(),
  );
}

function makeEmptyRow(periodStartDate: string, defaults?: Partial<RowDraft>): RowDraft {
  return {
    key: makeRowKey(),
    workerId: "",
    role: "",
    entryType: "payroll",
    workDate: periodStartDate,
    regularHours: "",
    overtimeHours: "",
    otherHours: "",
    ratePerHour: "",
    notes: "",
    rateOverridden: false,
    ...defaults,
  };
}

function makeRowFromEntry(entry: TimeEntry, periodStartDate: string): RowDraft {
  return {
    key: makeRowKey(),
    id: entry.id,
    workerId: String(entry.workerId),
    role: entry.role ?? "",
    entryType: entry.entryType,
    workDate: entry.workDate ?? periodStartDate,
    regularHours: entry.regularHours != null ? String(entry.regularHours) : "",
    overtimeHours: entry.overtimeHours != null ? String(entry.overtimeHours) : "",
    otherHours: entry.otherHours != null ? String(entry.otherHours) : "",
    ratePerHour: entry.ratePerHour != null ? String(entry.ratePerHour) : "",
    notes: entry.notes ?? "",
    rateOverridden: true,
  };
}

function resolveRowRate(
  row: RowDraft,
  worker: Worker | undefined,
  hotel: Hotel | undefined,
  hotelWorkerRates: WorkerHotelRate[],
): number | null {
  const workerId = toNumberOrNull(row.workerId);
  if (workerId != null) {
    const normalizedRole = normalizeRole(row.role);
    const exactOverride = hotelWorkerRates.find(
      (rate) => rate.workerId === workerId && normalizeRole(rate.role) === normalizedRole,
    );
    const genericOverride = hotelWorkerRates.find(
      (rate) => rate.workerId === workerId && normalizeRole(rate.role) == null,
    );
    const overrideRate = toNumberOrNull((exactOverride ?? genericOverride)?.rate);
    if (overrideRate != null) return overrideRate;
  }

  const workerRate = toNumberOrNull(worker?.defaultRate ?? null);
  if (workerRate != null) return workerRate;

  return resolveHotelPositionRate(hotel, row.role);
}

function focusCell(
  cellRefs: Record<string, HTMLElement | null>,
  rowKey: string,
  column: (typeof GRID_COLUMNS)[number],
): void {
  window.requestAnimationFrame(() => {
    cellRefs[`${rowKey}:${column}`]?.focus();
  });
}

export function HotelHoursSheet({
  open,
  periodId,
  periodStartDate,
  locked,
  section,
  entries,
  workers,
  hotels,
  onClose,
  onSaved,
}: HotelHoursSheetProps) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<RowDraft[]>([]);
  const [localWorkers, setLocalWorkers] = useState<Worker[]>(workers);
  const [quickAddRowKey, setQuickAddRowKey] = useState<string | null>(null);
  const [quickAddState, setQuickAddState] = useState<QuickAddWorkerState>({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    role: "",
    workerType: "payroll",
    defaultRate: "",
  });
  const cellRefs = useRef<Record<string, HTMLElement | null>>({});

  const hotel = section ? hotels.find((item) => item.id === section.hotelId) : undefined;
  const { data: hotelWorkerRates = [] } = useListHotelWorkerRates(section?.hotelId ?? 0);

  const saveEntries = useSaveHotelSectionEntries({
    mutation: {
      onSuccess: async () => {
        if (section) {
          await queryClient.invalidateQueries({ queryKey: getListHotelWorkerRatesQueryKey(section.hotelId) });
        }
        await onSaved();
        onClose();
      },
    },
  });

  const createWorker = useCreateWorker({
    mutation: {
      onSuccess: async (worker) => {
        setLocalWorkers((current) => {
          const existing = current.find((item) => item.id === worker.id);
          if (existing) {
            return current.map((item) => (item.id === worker.id ? worker : item));
          }
          return [...current, worker].sort((left, right) => left.name.localeCompare(right.name));
        });
        await queryClient.invalidateQueries({ queryKey: getListWorkersQueryKey() });

        if (quickAddRowKey) {
          setRows((current) =>
            current.map((row) => {
              if (row.key !== quickAddRowKey) return row;
              const resolvedRate = quickAddState.defaultRate || row.ratePerHour;
              return {
                ...row,
                workerId: String(worker.id),
                role: row.role || quickAddState.role,
                entryType: worker.workerType,
                ratePerHour: resolvedRate,
                rateOverridden: Boolean(resolvedRate),
              };
            }),
          );
        }

        setQuickAddRowKey(null);
        setQuickAddState({
          firstName: "",
          lastName: "",
          phone: "",
          email: "",
          role: "",
          workerType: "payroll",
          defaultRate: "",
        });
      },
    },
  });

  useEffect(() => {
    setLocalWorkers(workers);
  }, [workers]);

  useEffect(() => {
    if (!open || !section) return;

    const sectionEntries = entries.filter(
      (entry) =>
        entry.payPeriodHotelId === section.id ||
        (entry.payPeriodHotelId == null && entry.hotelId === section.hotelId),
    );

    const nextRows = sectionEntries.length > 0
      ? sectionEntries.map((entry) => makeRowFromEntry(entry, periodStartDate))
      : [];

    nextRows.push(
      makeEmptyRow(periodStartDate, {
        role: hotel?.jobPosition ?? "",
        ratePerHour: hotel?.payRate || "",
      }),
    );
    setRows(nextRows);
  }, [open, section, entries, hotel?.jobPosition, hotel?.payRate, periodStartDate, section?.hotelId]);

  const rowCount = rows.filter(hasRowContent).length;
  const hotelTotals = rows.reduce(
    (totals, row) => {
      if (!hasRowContent(row)) return totals;
      totals.regularHours += toNumberOrNull(row.regularHours) ?? 0;
      totals.overtimeHours += toNumberOrNull(row.overtimeHours) ?? 0;
      totals.otherHours += toNumberOrNull(row.otherHours) ?? 0;
      totals.totalHours += computeRowHours(row);
      totals.totalPay += computeRowPay(row);
      return totals;
    },
    { regularHours: 0, overtimeHours: 0, otherHours: 0, totalHours: 0, totalPay: 0 },
  );

  const updateRow = (rowKey: string, updater: (row: RowDraft) => RowDraft) => {
    setRows((current) => current.map((row) => (row.key === rowKey ? updater(row) : row)));
  };

  const addRow = (defaults?: Partial<RowDraft>) => {
    const nextRow = makeEmptyRow(periodStartDate, defaults);
    setRows((current) => [...current, nextRow]);
    return nextRow;
  };

  const ensureTrailingBlankRow = () => {
    setRows((current) => {
      if (current.length === 0) return [makeEmptyRow(periodStartDate, { role: hotel?.jobPosition ?? "", ratePerHour: hotel?.payRate || "" })];
      const lastRow = current[current.length - 1];
      if (!hasRowContent(lastRow)) return current;
      return [...current, makeEmptyRow(periodStartDate, { role: hotel?.jobPosition ?? "", ratePerHour: hotel?.payRate || "" })];
    });
  };

  const applyAutoRate = (rowKey: string, nextRow: RowDraft) => {
    const worker = localWorkers.find((item) => String(item.id) === nextRow.workerId);
    const resolvedRate = resolveRowRate(nextRow, worker, hotel, hotelWorkerRates);
    if (resolvedRate == null) return nextRow;
    return {
      ...nextRow,
      ratePerHour: nextRow.rateOverridden && nextRow.ratePerHour.trim() ? nextRow.ratePerHour : String(resolvedRate),
    };
  };

  const handleWorkerSelect = (rowKey: string, workerId: string) => {
    updateRow(rowKey, (row) => {
      const worker = localWorkers.find((item) => String(item.id) === workerId);
      const nextRow = {
        ...row,
        workerId,
        entryType: worker?.workerType ?? row.entryType,
      };
      return applyAutoRate(rowKey, nextRow);
    });
    ensureTrailingBlankRow();
  };

  const handleRoleChange = (rowKey: string, role: string) => {
    updateRow(rowKey, (row) => applyAutoRate(rowKey, { ...row, role }));
  };

  const handleRateChange = (rowKey: string, ratePerHour: string) => {
    updateRow(rowKey, (row) => ({ ...row, ratePerHour, rateOverridden: ratePerHour.trim() !== "" }));
  };

  const handleInputChange = (rowKey: string, field: keyof RowDraft, value: string) => {
    if (field === "role") {
      handleRoleChange(rowKey, value);
      return;
    }

    if (field === "ratePerHour") {
      handleRateChange(rowKey, value);
      return;
    }

    updateRow(rowKey, (row) => ({ ...row, [field]: value }));
    ensureTrailingBlankRow();
  };

  const removeRow = (rowKey: string) => {
    setRows((current) => {
      const nextRows = current.filter((row) => row.key !== rowKey);
      return nextRows.length > 0 ? nextRows : [makeEmptyRow(periodStartDate)];
    });
  };

  const handleEnterKey = (event: React.KeyboardEvent<HTMLElement>, rowIndex: number, column: (typeof GRID_COLUMNS)[number]) => {
    if (event.key !== "Enter") return;
    event.preventDefault();

    const nextRow = rows[rowIndex + 1] ?? addRow();
    focusCell(cellRefs.current, nextRow.key, column);
  };

  const handleSave = async () => {
    if (!section) return;

    const payloadRows = rows.filter(hasRowContent);
    if (payloadRows.some((row) => !row.workerId)) {
      alert("Every saved row must include a worker.");
      return;
    }

    const hasNegativeValue = payloadRows.some((row) =>
      [row.regularHours, row.overtimeHours, row.otherHours, row.ratePerHour].some(
        (value) => value.trim() && Number(value) < 0,
      ),
    );
    if (hasNegativeValue) {
      alert("Hours and rates cannot be negative.");
      return;
    }

    const data: BulkSaveHotelEntriesBody = {
      entries: payloadRows.map((row) => ({
        id: row.id ?? null,
        workerId: Number(row.workerId),
        role: row.role.trim() || null,
        entryType: row.entryType,
        workDate: row.workDate || null,
        regularHours: toNumberOrNull(row.regularHours),
        overtimeHours: toNumberOrNull(row.overtimeHours),
        otherHours: toNumberOrNull(row.otherHours),
        totalHours: computeRowHours(row),
        hoursWorked: computeRowHours(row),
        ratePerHour: toNumberOrNull(row.ratePerHour),
        totalAmount: computeRowPay(row),
        notes: row.notes.trim() || null,
      })),
    };

    await saveEntries.mutateAsync({ periodId, id: section.id, data });
  };

  const openQuickAdd = (rowKey: string, row: RowDraft) => {
    setQuickAddRowKey(rowKey);
    setQuickAddState({
      firstName: "",
      lastName: "",
      phone: "",
      email: "",
      role: row.role,
      workerType: row.entryType,
      defaultRate: row.ratePerHour,
    });
  };

  const submitQuickAddWorker = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = `${quickAddState.firstName} ${quickAddState.lastName}`.trim();
    if (!name) {
      alert("First and last name are required.");
      return;
    }

    const data: CreateWorkerBody = {
      name,
      workerType: quickAddState.workerType,
      phone: quickAddState.phone || null,
      email: quickAddState.email || null,
      defaultRate: toNumberOrNull(quickAddState.defaultRate),
      paymentMethod: "etransfer",
    };

    await createWorker.mutateAsync({ data });
  };

  return (
    <>
      <Sheet open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
        <SheetContent side="right" className="w-[94vw] max-w-none p-0 sm:max-w-none">
          <div className="flex h-full flex-col bg-background">
            <SheetHeader className="border-b border-border px-5 py-4">
              <div className="flex items-start justify-between gap-4 pr-8">
                <div>
                  <SheetTitle className="text-2xl font-bold">{section?.hotelName || "Enter Hours"}</SheetTitle>
                  <SheetDescription className="mt-1 text-sm">
                    Fast hotel timesheet entry. Rates auto-fill from saved hotel rates, worker defaults, then hotel defaults.
                  </SheetDescription>
                </div>
                <div className="grid grid-cols-2 gap-3 text-right md:grid-cols-4">
                  <SummaryStat label="Workers" value={String(rowCount)} />
                  <SummaryStat label="Reg" value={hotelTotals.regularHours.toFixed(2)} />
                  <SummaryStat label="Hours" value={hotelTotals.totalHours.toFixed(2)} />
                  <SummaryStat label="Payroll" value={formatCurrency(hotelTotals.totalPay)} />
                </div>
              </div>
            </SheetHeader>

            {locked ? (
              <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
                This pay period is finalized. Entries are locked.
              </div>
            ) : null}

            <div className="border-b border-border px-5 py-3">
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span>{section?.region || hotel?.region || "No region"}</span>
                <span>Hotel default rate: {formatCurrency(toNumberOrNull(hotel?.payRate) ?? 0)}</span>
                <span>{hotel?.positions?.length ?? 0} synced role rates</span>
              </div>
            </div>

            <div className="flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="min-w-[1120px] px-5 py-4">
                  <table className="w-full border-separate border-spacing-0 text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_theme(colors.border)]">
                      <tr>
                        <th className="w-[220px] px-2 py-2 font-semibold text-muted-foreground">Worker</th>
                        <th className="w-[220px] px-2 py-2 font-semibold text-muted-foreground">Role / Type</th>
                        <th className="w-[90px] px-2 py-2 text-right font-semibold text-muted-foreground">Reg</th>
                        <th className="w-[90px] px-2 py-2 text-right font-semibold text-muted-foreground">OT</th>
                        <th className="w-[90px] px-2 py-2 text-right font-semibold text-muted-foreground">Other</th>
                        <th className="w-[110px] px-2 py-2 text-right font-semibold text-muted-foreground">Total Hours</th>
                        <th className="w-[100px] px-2 py-2 text-right font-semibold text-muted-foreground">Rate</th>
                        <th className="w-[120px] px-2 py-2 text-right font-semibold text-muted-foreground">Total Pay</th>
                        <th className="px-2 py-2 font-semibold text-muted-foreground">Notes</th>
                        <th className="w-[52px] px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => {
                        const worker = localWorkers.find((item) => String(item.id) === row.workerId);
                        const totalHours = computeRowHours(row);
                        const totalPay = computeRowPay(row);

                        return (
                          <tr key={row.key} className="border-b border-border/60 align-top">
                            <td className="px-2 py-2">
                              <WorkerPickerCell
                                value={worker?.name ?? ""}
                                workers={localWorkers}
                                onSelect={(workerId) => handleWorkerSelect(row.key, workerId)}
                                onQuickAdd={() => openQuickAdd(row.key, row)}
                                buttonRef={(node) => {
                                  cellRefs.current[`${row.key}:worker`] = node;
                                }}
                                onKeyDown={(event) => handleEnterKey(event, index, "worker")}
                              />
                            </td>
                            <td className="px-2 py-2">
                              <div className="grid grid-cols-[1fr_92px] gap-2">
                                <Input
                                  value={row.role}
                                  onChange={(event) => handleInputChange(row.key, "role", event.target.value)}
                                  onKeyDown={(event) => handleEnterKey(event, index, "role")}
                                  placeholder={hotel?.jobPosition || "Role"}
                                  className={COMPACT_INPUT_CLASS}
                                  ref={(node) => {
                                    cellRefs.current[`${row.key}:role`] = node;
                                  }}
                                  disabled={locked}
                                />
                                <select
                                  value={row.entryType}
                                  onChange={(event) => updateRow(row.key, (current) => ({ ...current, entryType: event.target.value as RowDraft["entryType"] }))}
                                  className={cn(COMPACT_INPUT_CLASS, "bg-background")}
                                  disabled={locked}
                                >
                                  <option value="payroll">Payroll</option>
                                  <option value="subcontractor">Subcon</option>
                                </select>
                              </div>
                            </td>
                            <td className="px-2 py-2">
                              <Input
                                value={row.regularHours}
                                onChange={(event) => handleInputChange(row.key, "regularHours", event.target.value)}
                                onKeyDown={(event) => handleEnterKey(event, index, "regularHours")}
                                inputMode="decimal"
                                className={cn(COMPACT_INPUT_CLASS, "text-right")}
                                ref={(node) => {
                                  cellRefs.current[`${row.key}:regularHours`] = node;
                                }}
                                disabled={locked}
                              />
                            </td>
                            <td className="px-2 py-2">
                              <Input
                                value={row.overtimeHours}
                                onChange={(event) => handleInputChange(row.key, "overtimeHours", event.target.value)}
                                onKeyDown={(event) => handleEnterKey(event, index, "overtimeHours")}
                                inputMode="decimal"
                                className={cn(COMPACT_INPUT_CLASS, "text-right")}
                                ref={(node) => {
                                  cellRefs.current[`${row.key}:overtimeHours`] = node;
                                }}
                                disabled={locked}
                              />
                            </td>
                            <td className="px-2 py-2">
                              <Input
                                value={row.otherHours}
                                onChange={(event) => handleInputChange(row.key, "otherHours", event.target.value)}
                                onKeyDown={(event) => handleEnterKey(event, index, "otherHours")}
                                inputMode="decimal"
                                className={cn(COMPACT_INPUT_CLASS, "text-right")}
                                ref={(node) => {
                                  cellRefs.current[`${row.key}:otherHours`] = node;
                                }}
                                disabled={locked}
                              />
                            </td>
                            <td className="px-2 py-2 text-right text-sm font-semibold text-foreground">
                              <div className="flex h-9 items-center justify-end rounded-lg border border-border bg-secondary/30 px-2">
                                {totalHours.toFixed(2)}
                              </div>
                            </td>
                            <td className="px-2 py-2">
                              <Input
                                value={row.ratePerHour}
                                onChange={(event) => handleInputChange(row.key, "ratePerHour", event.target.value)}
                                onKeyDown={(event) => handleEnterKey(event, index, "ratePerHour")}
                                inputMode="decimal"
                                className={cn(COMPACT_INPUT_CLASS, "text-right")}
                                ref={(node) => {
                                  cellRefs.current[`${row.key}:ratePerHour`] = node;
                                }}
                                disabled={locked}
                              />
                            </td>
                            <td className="px-2 py-2 text-right text-sm font-semibold text-foreground">
                              <div className="flex h-9 items-center justify-end rounded-lg border border-border bg-secondary/30 px-2">
                                {formatCurrency(totalPay)}
                              </div>
                            </td>
                            <td className="px-2 py-2">
                              <Input
                                value={row.notes}
                                onChange={(event) => handleInputChange(row.key, "notes", event.target.value)}
                                onKeyDown={(event) => handleEnterKey(event, index, "notes")}
                                placeholder="Optional"
                                className={COMPACT_INPUT_CLASS}
                                ref={(node) => {
                                  cellRefs.current[`${row.key}:notes`] = node;
                                }}
                                disabled={locked}
                              />
                            </td>
                            <td className="px-2 py-2">
                              <Button
                                type="button"
                                variant="ghost"
                                className="h-9 min-h-0 rounded-lg px-2 py-0 text-muted-foreground"
                                onClick={() => removeRow(row.key)}
                                disabled={locked || (!row.id && !hasRowContent(row) && rows.length === 1)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </ScrollArea>
            </div>

            <div className="border-t border-border bg-background px-5 py-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <Button type="button" variant="outline" className="h-9 min-h-0 px-3 py-0 text-sm" onClick={() => addRow()} disabled={locked}>
                    <Plus className="mr-2 h-4 w-4" /> Add Row
                  </Button>
                  <span className="text-muted-foreground">OT {hotelTotals.overtimeHours.toFixed(2)}</span>
                  <span className="text-muted-foreground">Other {hotelTotals.otherHours.toFixed(2)}</span>
                  <span className="font-semibold">Total Hours {hotelTotals.totalHours.toFixed(2)}</span>
                  <span className="font-semibold">Payroll {formatCurrency(hotelTotals.totalPay)}</span>
                </div>
                <div className="flex items-center justify-end gap-3">
                  <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
                  <Button type="button" onClick={handleSave} isLoading={saveEntries.isPending} disabled={locked}>
                    Save Hours
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={quickAddRowKey != null} onOpenChange={(nextOpen) => !nextOpen && setQuickAddRowKey(null)} title="Quick Add Worker">
        <form className="space-y-5" onSubmit={submitQuickAddWorker}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>First Name *</Label>
              <Input value={quickAddState.firstName} onChange={(event) => setQuickAddState((current) => ({ ...current, firstName: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Last Name *</Label>
              <Input value={quickAddState.lastName} onChange={(event) => setQuickAddState((current) => ({ ...current, lastName: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={quickAddState.phone} onChange={(event) => setQuickAddState((current) => ({ ...current, phone: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={quickAddState.email} onChange={(event) => setQuickAddState((current) => ({ ...current, email: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Input value={quickAddState.role} onChange={(event) => setQuickAddState((current) => ({ ...current, role: event.target.value }))} placeholder="Housekeeping, Front Desk..." />
            </div>
            <div className="space-y-2">
              <Label>Default Rate</Label>
              <Input value={quickAddState.defaultRate} onChange={(event) => setQuickAddState((current) => ({ ...current, defaultRate: event.target.value }))} inputMode="decimal" placeholder="20.00" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Worker Type</Label>
              <select
                value={quickAddState.workerType}
                onChange={(event) => setQuickAddState((current) => ({ ...current, workerType: event.target.value as QuickAddWorkerState["workerType"] }))}
                className={cn(COMPACT_INPUT_CLASS, "h-11 bg-background")}
              >
                <option value="payroll">Payroll</option>
                <option value="subcontractor">Subcontractor</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={() => setQuickAddRowKey(null)}>Cancel</Button>
            <Button type="submit" isLoading={createWorker.isPending}>Create Worker</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function WorkerPickerCell({
  value,
  workers,
  onSelect,
  onQuickAdd,
  buttonRef,
  onKeyDown,
}: {
  value: string;
  workers: Worker[];
  onSelect: (workerId: string) => void;
  onQuickAdd: () => void;
  buttonRef: (node: HTMLButtonElement | null) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          ref={buttonRef}
          className={cn(
            COMPACT_INPUT_CLASS,
            "flex w-full items-center justify-between gap-2 rounded-lg bg-background text-left",
            value ? "text-foreground" : "text-muted-foreground",
          )}
          onKeyDown={onKeyDown}
        >
          <span className="truncate">{value || "Select worker"}</span>
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search workers..." />
          <CommandList>
            <CommandEmpty>
              <div className="space-y-3 p-3 text-sm">
                <p>No worker found.</p>
                <Button type="button" variant="outline" className="h-8 min-h-0 px-3 py-0 text-sm" onClick={() => { setOpen(false); onQuickAdd(); }}>
                  <UserPlus className="mr-2 h-4 w-4" /> Quick Add Worker
                </Button>
              </div>
            </CommandEmpty>
            {workers.map((worker) => (
              <CommandItem
                key={worker.id}
                value={`${worker.name} ${worker.workerType} ${worker.phone || ""} ${worker.email || ""}`}
                onSelect={() => {
                  onSelect(String(worker.id));
                  setOpen(false);
                }}
              >
                <Check className={cn("h-4 w-4", value === worker.name ? "opacity-100" : "opacity-0")} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{worker.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {worker.workerType} {worker.defaultRate != null ? `• ${formatCurrency(worker.defaultRate)}` : ""}
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
        <div className="border-t border-border p-2">
          <Button type="button" variant="ghost" className="h-8 min-h-0 w-full px-3 py-0 text-sm" onClick={() => { setOpen(false); onQuickAdd(); }}>
            <UserPlus className="mr-2 h-4 w-4" /> Quick Add Worker
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-base font-semibold text-foreground">{value}</p>
    </div>
  );
}