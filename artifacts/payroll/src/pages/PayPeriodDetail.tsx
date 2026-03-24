import { useEffect, useState } from "react";
import {
  getGetPayPeriodQueryKey,
  getGetPayPeriodTallyQueryKey,
  useCreateTimeEntry,
  useDeleteTimeEntry,
  useGetPayPeriod,
  useGetPayPeriodTally,
  useListHotels,
  useListWorkers,
  useUpdateTimeEntry,
  type CreateTimeEntryBody,
  type Hotel,
  type TimeEntry,
  type UpdateTimeEntryBody,
  type Worker,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, StatusBadge, Button, Dialog, Input, Label } from "@/components/ui";
import { formatDate, formatCurrency, cn } from "@/lib/utils";
import {
  Building2,
  Users,
  Receipt,
  FileSpreadsheet,
  Send,
  FileDown,
  Plus,
  Pencil,
  Trash2,
  UploadCloud,
} from "lucide-react";

const SELECT_CLASS =
  "flex min-h-[48px] w-full rounded-xl border-2 border-border bg-background px-4 py-2 text-lg focus:border-primary focus:ring-4 outline-none";

type EntryFormState = {
  workerId: string;
  hotelId: string;
  entryType: "payroll" | "subcontractor";
  workDate: string;
  hoursWorked: string;
  ratePerHour: string;
  flatAmount: string;
  notes: string;
};

function formatWorkDate(value?: string | null): string {
  if (!value) return "No date";

  try {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(`${value}T00:00:00`));
  } catch {
    return value;
  }
}

function computeTotalAmount(hoursWorked: string, ratePerHour: string, flatAmount: string): number {
  const flat = Number(flatAmount);
  if (flatAmount.trim() && !Number.isNaN(flat)) {
    return flat;
  }

  const hours = Number(hoursWorked);
  const rate = Number(ratePerHour);
  const total = (Number.isNaN(hours) ? 0 : hours) * (Number.isNaN(rate) ? 0 : rate);
  return Number.isFinite(total) ? total : 0;
}

function makeInitialForm(periodStartDate: string, entry?: TimeEntry | null): EntryFormState {
  return {
    workerId: entry?.workerId ? String(entry.workerId) : "",
    hotelId: entry?.hotelId ? String(entry.hotelId) : "",
    entryType: entry?.entryType ?? "payroll",
    workDate: entry?.workDate ?? periodStartDate,
    hoursWorked: entry?.hoursWorked != null ? String(entry.hoursWorked) : "",
    ratePerHour: entry?.ratePerHour != null ? String(entry.ratePerHour) : "",
    flatAmount: entry?.flatAmount != null ? String(entry.flatAmount) : "",
    notes: entry?.notes ?? "",
  };
}

export default function PayPeriodDetail({ params }: { params: { id: string } }) {
  const periodId = parseInt(params.id, 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: period, isLoading } = useGetPayPeriod(periodId);
  const { data: workers } = useListWorkers();
  const { data: hotels } = useListHotels();
  const workerCount = workers?.length ?? 0;
  const hotelCount = hotels?.length ?? 0;
  const hasWorkers = workerCount > 0;
  const hasHotels = hotelCount > 0;

  const [activeTab, setActiveTab] = useState("hours");
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);

  const refreshPeriod = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetPayPeriodQueryKey(periodId) }),
      queryClient.invalidateQueries({ queryKey: getGetPayPeriodTallyQueryKey(periodId) }),
    ]);
  };

  const createEntry = useCreateTimeEntry({
    mutation: {
      onSuccess: async () => {
        await refreshPeriod();
        setIsEntryModalOpen(false);
        setEditingEntry(null);
      },
    },
  });

  const updateEntry = useUpdateTimeEntry({
    mutation: {
      onSuccess: async () => {
        await refreshPeriod();
        setIsEntryModalOpen(false);
        setEditingEntry(null);
      },
    },
  });

  const deleteEntry = useDeleteTimeEntry({
    mutation: {
      onSuccess: async () => {
        await refreshPeriod();
      },
    },
  });

  if (isLoading) return <div className="p-10 text-2xl animate-pulse text-center">Loading workspace...</div>;
  if (!period) {
    return (
      <Card className="p-10 text-center space-y-6">
        <div>
          <h1 className="text-3xl font-black text-destructive mb-3">Pay period not found</h1>
          <p className="text-lg text-muted-foreground">This pay period link is invalid or the record was deleted.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-4">
          <Button onClick={() => setLocation("/pay-periods")}>Back to Pay Periods</Button>
          <Button variant="outline" onClick={() => setLocation("/workers")}>Open Workers Directory</Button>
        </div>
      </Card>
    );
  }

  const tabs = [
    { id: "hours", label: "Add Hours", icon: Plus },
    { id: "hotel", label: "By Hotel", icon: Building2 },
    { id: "worker", label: "By Worker", icon: Users },
    { id: "tally", label: "Tally", icon: Receipt },
    { id: "payment", label: "Payment Prep", icon: Send },
    { id: "export", label: "Export", icon: FileDown },
  ];

  const handleAddEntry = () => {
    if (!hasWorkers) {
      setLocation("/workers");
      return;
    }

    setEditingEntry(null);
    setIsEntryModalOpen(true);
  };

  const handleEditEntry = (entry: TimeEntry) => {
    setEditingEntry(entry);
    setIsEntryModalOpen(true);
  };

  const handleDeleteEntry = async (entry: TimeEntry) => {
    if (!confirm(`Delete the hours entry for ${entry.workerName}?`)) return;
    await deleteEntry.mutateAsync({ periodId, id: entry.id });
  };

  const handleSubmitEntry = async (data: CreateTimeEntryBody | UpdateTimeEntryBody) => {
    if (editingEntry) {
      await updateEntry.mutateAsync({ periodId, id: editingEntry.id, data });
      return;
    }

    await createEntry.mutateAsync({ periodId, data: data as CreateTimeEntryBody });
  };

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
      <Card className="p-8 bg-gradient-to-r from-primary to-primary/80 text-primary-foreground border-none shadow-xl">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div>
              <div className="flex items-center gap-4 mb-2">
                <h1 className="text-4xl font-black">{period.name}</h1>
                <span className="bg-white/20 px-3 py-1 rounded-full text-sm font-bold uppercase tracking-wider">
                  {period.status.replace("_", " ")}
                </span>
              </div>
              <p className="text-xl text-primary-foreground/80 font-medium">
                {formatDate(period.startDate)} to {formatDate(period.endDate)}
              </p>
            </div>
            <div className="flex gap-8 bg-black/20 p-4 rounded-2xl backdrop-blur-sm">
              <div>
                <p className="text-sm font-bold text-primary-foreground/70 uppercase">Payroll</p>
                <p className="text-2xl font-bold">{formatCurrency(period.totalPayroll)}</p>
              </div>
              <div>
                <p className="text-sm font-bold text-primary-foreground/70 uppercase">Subcontractors</p>
                <p className="text-2xl font-bold">{formatCurrency(period.totalSubcontractors)}</p>
              </div>
              <div className="border-l border-white/20 pl-8">
                <p className="text-sm font-bold text-emerald-300 uppercase">Grand Total</p>
                <p className="text-4xl font-black text-white">{formatCurrency(period.totalGrand)}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <Button onClick={handleAddEntry} className="bg-white text-primary hover:bg-white/90 gap-2">
              <Plus className="w-5 h-5" /> Add Hours
            </Button>
            <Button
              onClick={() => setLocation("/import")}
              variant="outline"
              className="gap-2 border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white"
            >
              <UploadCloud className="w-5 h-5" /> Optional Excel Import
            </Button>
          </div>
        </div>
      </Card>

      {!hasWorkers && (
        <Card className="p-8 border-amber-200 bg-amber-50">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-amber-950">Set up workers before entering hours</h2>
              <p className="text-lg text-amber-900">You need at least one worker before this pay period can accept hours entries.</p>
              <p className="text-base text-amber-800">Hotels and sites are optional, but recommended so entries can be assigned to a workplace.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => setLocation("/workers")} className="gap-2 bg-amber-900 text-white hover:bg-amber-950">
                <Users className="w-5 h-5" /> Add Worker
              </Button>
              <Button variant="outline" onClick={() => setLocation("/hotels")} className="gap-2 border-amber-300 text-amber-950 hover:bg-amber-100">
                <Building2 className="w-5 h-5" /> Add Hotel or Site
              </Button>
            </div>
          </div>
        </Card>
      )}

      {hasWorkers && !hasHotels && (
        <Card className="p-6 border-sky-200 bg-sky-50">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-sky-950">No hotels or sites added yet</h2>
              <p className="text-base text-sky-900">You can still enter hours now and leave the hotel blank, or add workplaces first.</p>
            </div>
            <Button variant="outline" onClick={() => setLocation("/hotels")} className="gap-2 border-sky-300 text-sky-950 hover:bg-sky-100">
              <Building2 className="w-5 h-5" /> Add Hotel or Site
            </Button>
          </div>
        </Card>
      )}

      <div className="flex overflow-x-auto gap-2 pb-2 hide-scrollbar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-3 px-6 py-4 rounded-2xl font-semibold text-lg transition-all whitespace-nowrap",
              activeTab === tab.id
                ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <tab.icon className="w-5 h-5" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-[500px]">
        {activeTab === "hours" && (
          <HoursEntryTab
            entries={period.entries}
            onAdd={handleAddEntry}
            onEdit={handleEditEntry}
            onDelete={handleDeleteEntry}
            isDeleting={deleteEntry.isPending}
          />
        )}
        {activeTab === "hotel" && <GroupedEntriesTab entries={period.entries} groupBy="hotelName" />}
        {activeTab === "worker" && <GroupedEntriesTab entries={period.entries} groupBy="workerName" />}
        {activeTab === "tally" && <TallyTab periodId={period.id} />}
        {activeTab === "payment" && <PaymentPrepTab payments={period.payments} />}
        {activeTab === "export" && <ExportTab periodId={period.id} />}
      </div>

      <EntryModal
        open={isEntryModalOpen}
        onClose={() => {
          setIsEntryModalOpen(false);
          setEditingEntry(null);
        }}
        entry={editingEntry}
        periodStartDate={period.startDate}
        workers={workers ?? []}
        hotels={hotels ?? []}
        onSubmit={handleSubmitEntry}
        isSaving={createEntry.isPending || updateEntry.isPending}
      />
    </div>
  );
}

function HoursEntryTab({
  entries,
  onAdd,
  onEdit,
  onDelete,
  isDeleting,
}: {
  entries: TimeEntry[];
  onAdd: () => void;
  onEdit: (entry: TimeEntry) => void;
  onDelete: (entry: TimeEntry) => void;
  isDeleting: boolean;
}) {
  const totalHours = entries.reduce((sum, entry) => sum + (entry.hoursWorked ?? 0), 0);

  if (entries.length === 0) {
    return (
      <Card className="p-10 text-center">
        <h2 className="text-3xl font-bold mb-3">No hours entered yet</h2>
        <p className="text-xl text-muted-foreground mb-8">Click Add Hours to start entering daily work directly in the app.</p>
        <Button onClick={onAdd} className="gap-2">
          <Plus className="w-5 h-5" /> Add First Entry
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-6 bg-secondary/40">
        <div className="flex flex-col md:flex-row justify-between gap-4 md:items-center">
          <div>
            <h2 className="text-2xl font-bold">Hours Entry</h2>
            <p className="text-lg text-muted-foreground">Edit worker hours here. Import is optional.</p>
          </div>
          <div className="flex gap-8">
            <div>
              <p className="text-sm font-semibold text-muted-foreground uppercase">Entries</p>
              <p className="text-3xl font-black">{entries.length}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-muted-foreground uppercase">Total Hours</p>
              <p className="text-3xl font-black">{totalHours.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-muted-foreground uppercase">Total Amount</p>
              <p className="text-3xl font-black">{formatCurrency(entries.reduce((sum, entry) => sum + entry.totalAmount, 0))}</p>
            </div>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="bg-secondary p-4 px-6 flex justify-between items-center border-b">
          <h3 className="text-2xl font-bold text-foreground">Daily Entries</h3>
          <Button onClick={onAdd} className="gap-2">
            <Plus className="w-5 h-5" /> Add Hours
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-card">
              <tr>
                <th className="p-4 font-semibold text-muted-foreground">Date</th>
                <th className="p-4 font-semibold text-muted-foreground">Worker</th>
                <th className="p-4 font-semibold text-muted-foreground">Hotel</th>
                <th className="p-4 font-semibold text-muted-foreground">Type</th>
                <th className="p-4 font-semibold text-muted-foreground text-right">Hours</th>
                <th className="p-4 font-semibold text-muted-foreground text-right">Rate</th>
                <th className="p-4 font-semibold text-muted-foreground text-right">Total</th>
                <th className="p-4 font-semibold text-muted-foreground">Status</th>
                <th className="p-4 font-semibold text-muted-foreground text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t hover:bg-accent/30">
                  <td className="p-4 font-medium">{formatWorkDate(entry.workDate)}</td>
                  <td className="p-4 font-medium">{entry.workerName}</td>
                  <td className="p-4 text-muted-foreground">{entry.hotelName || "Unassigned"}</td>
                  <td className="p-4 capitalize text-muted-foreground">{entry.entryType}</td>
                  <td className="p-4 text-right">{entry.hoursWorked ?? "-"}</td>
                  <td className="p-4 text-right">{entry.ratePerHour != null ? formatCurrency(entry.ratePerHour) : "-"}</td>
                  <td className="p-4 text-right font-bold">{formatCurrency(entry.totalAmount)}</td>
                  <td className="p-4"><StatusBadge status={entry.paymentStatus} /></td>
                  <td className="p-4">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" className="px-3" onClick={() => onEdit(entry)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="danger" className="px-3" disabled={isDeleting} onClick={() => onDelete(entry)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function GroupedEntriesTab({ entries, groupBy }: { entries: TimeEntry[]; groupBy: "hotelName" | "workerName" }) {
  const grouped = entries.reduce<Record<string, TimeEntry[]>>((acc, entry) => {
    const key = entry[groupBy] || "Unassigned";
    if (!acc[key]) acc[key] = [];
    acc[key].push(entry);
    return acc;
  }, {});

  if (entries.length === 0) {
    return <Card className="p-10 text-center text-xl text-muted-foreground">No entries found.</Card>;
  }

  return (
    <div className="space-y-8">
      {(Object.entries(grouped) as Array<[string, TimeEntry[]]>).map(([groupName, groupEntries]) => {
        const groupTotal = groupEntries.reduce((sum, entry) => sum + entry.totalAmount, 0);
        return (
          <Card key={groupName} className="overflow-hidden">
            <div className="bg-secondary p-4 px-6 flex justify-between items-center border-b">
              <h3 className="text-2xl font-bold text-foreground">{groupName}</h3>
              <p className="text-xl font-bold text-primary">{formatCurrency(groupTotal)}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-card">
                  <tr>
                    <th className="p-4 font-semibold text-muted-foreground">Date</th>
                    <th className="p-4 font-semibold text-muted-foreground">Worker / Hotel</th>
                    <th className="p-4 font-semibold text-muted-foreground">Type</th>
                    <th className="p-4 font-semibold text-muted-foreground text-right">Hours</th>
                    <th className="p-4 font-semibold text-muted-foreground text-right">Rate</th>
                    <th className="p-4 font-semibold text-muted-foreground text-right">Total</th>
                    <th className="p-4 font-semibold text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {groupEntries.map((entry) => (
                    <tr key={entry.id} className="border-t hover:bg-accent/30">
                      <td className="p-4 font-medium">{formatWorkDate(entry.workDate)}</td>
                      <td className="p-4 font-medium">
                        {groupBy === "hotelName" ? entry.workerName : entry.hotelName || "N/A"}
                      </td>
                      <td className="p-4 capitalize text-muted-foreground">{entry.entryType}</td>
                      <td className="p-4 text-right">{entry.hoursWorked ?? "-"}</td>
                      <td className="p-4 text-right">{entry.ratePerHour != null ? formatCurrency(entry.ratePerHour) : "-"}</td>
                      <td className="p-4 text-right font-bold">{formatCurrency(entry.totalAmount)}</td>
                      <td className="p-4"><StatusBadge status={entry.paymentStatus} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function TallyTab({ periodId }: { periodId: number }) {
  const { data: tally, isLoading } = useGetPayPeriodTally(periodId);

  if (isLoading) return <div className="p-10 animate-pulse text-xl">Loading tally...</div>;
  if (!tally) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <Card className="p-6 col-span-full bg-slate-900 text-white">
        <h3 className="text-2xl font-bold mb-6 text-slate-300">Period Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div><p className="text-slate-400">Total Payroll</p><p className="text-2xl font-bold">{formatCurrency(tally.totalPayroll)}</p></div>
          <div><p className="text-slate-400">Subcontractors</p><p className="text-2xl font-bold">{formatCurrency(tally.totalSubcontractors)}</p></div>
          <div><p className="text-slate-400">Worker Count</p><p className="text-2xl font-bold">{tally.workerCount}</p></div>
          <div><p className="text-slate-400">Missing Info</p><p className="text-2xl font-bold text-red-400">{tally.missingInfoCount}</p></div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-xl font-bold mb-4">By Hotel</h3>
        <div className="space-y-3">
          {tally.byHotel.map((hotel) => (
            <div key={hotel.hotelName} className="flex justify-between border-b pb-2">
              <span>{hotel.hotelName} <span className="text-muted-foreground ml-2">({hotel.workerCount} workers)</span></span>
              <span className="font-bold">{formatCurrency(hotel.totalAmount)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-xl font-bold mb-4">By Region</h3>
        <div className="space-y-3">
          {tally.byRegion.map((region) => (
            <div key={region.region} className="flex justify-between border-b pb-2">
              <span className="font-semibold">{region.region}</span>
              <span className="font-bold text-primary">{formatCurrency(region.totalAmount)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function PaymentPrepTab({
  payments,
}: {
  payments: Array<{ id: number; workerName: string; interacEmail?: string | null; amount: number; paymentMethod: string; status: string }>;
}) {
  const etransfers = payments.filter((payment) => payment.paymentMethod === "etransfer");
  const cheques = payments.filter((payment) => payment.paymentMethod === "cheque");

  return (
    <div className="space-y-8">
      <Card className="overflow-hidden">
        <div className="bg-indigo-50 p-4 px-6 border-b border-indigo-100">
          <h3 className="text-2xl font-bold text-indigo-900">E-Transfers ({etransfers.length})</h3>
        </div>
        <table className="w-full text-left">
          <thead className="bg-card">
            <tr>
              <th className="p-4 text-muted-foreground">Worker</th>
              <th className="p-4 text-muted-foreground">Email</th>
              <th className="p-4 text-muted-foreground text-right">Amount</th>
              <th className="p-4 text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {etransfers.map((payment) => (
              <tr key={payment.id} className="border-t">
                <td className="p-4 font-semibold">{payment.workerName}</td>
                <td className="p-4 text-primary">{payment.interacEmail || "MISSING"}</td>
                <td className="p-4 font-bold text-right">{formatCurrency(payment.amount)}</td>
                <td className="p-4"><StatusBadge status={payment.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="overflow-hidden">
        <div className="bg-emerald-50 p-4 px-6 border-b border-emerald-100">
          <h3 className="text-2xl font-bold text-emerald-900">Cheques ({cheques.length})</h3>
        </div>
        <table className="w-full text-left">
          <thead className="bg-card">
            <tr>
              <th className="p-4 text-muted-foreground">Worker</th>
              <th className="p-4 text-muted-foreground text-right">Amount</th>
              <th className="p-4 text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {cheques.map((payment) => (
              <tr key={payment.id} className="border-t">
                <td className="p-4 font-semibold">{payment.workerName}</td>
                <td className="p-4 font-bold text-right">{formatCurrency(payment.amount)}</td>
                <td className="p-4"><StatusBadge status={payment.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function ExportTab({ periodId }: { periodId: number }) {
  const handleExport = (type: string) => {
    window.open(`/api/pay-periods/${periodId}/export?type=${type}`, "_blank");
  };

  return (
    <Card className="p-8">
      <h3 className="text-3xl font-bold mb-8">Export & Reports</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Button onClick={() => handleExport("payroll")} variant="outline" className="h-20 text-lg flex justify-start px-6 gap-4">
          <FileSpreadsheet className="w-8 h-8 text-primary" /> Payroll CSV
        </Button>
        <Button onClick={() => handleExport("subcontractors")} variant="outline" className="h-20 text-lg flex justify-start px-6 gap-4">
          <FileSpreadsheet className="w-8 h-8 text-primary" /> Subcontractors CSV
        </Button>
        <Button onClick={() => handleExport("etransfer")} variant="outline" className="h-20 text-lg flex justify-start px-6 gap-4">
          <FileSpreadsheet className="w-8 h-8 text-indigo-500" /> E-Transfer List
        </Button>
        <Button onClick={() => handleExport("cheque")} variant="outline" className="h-20 text-lg flex justify-start px-6 gap-4">
          <FileSpreadsheet className="w-8 h-8 text-emerald-500" /> Cheque List
        </Button>
        <Button onClick={() => handleExport("tally")} variant="outline" className="h-20 text-lg flex justify-start px-6 gap-4">
          <FileSpreadsheet className="w-8 h-8 text-slate-500" /> Tally Report
        </Button>
      </div>
    </Card>
  );
}

function EntryModal({
  open,
  onClose,
  entry,
  periodStartDate,
  workers,
  hotels,
  onSubmit,
  isSaving,
}: {
  open: boolean;
  onClose: () => void;
  entry: TimeEntry | null;
  periodStartDate: string;
  workers: Worker[];
  hotels: Hotel[];
  onSubmit: (data: CreateTimeEntryBody | UpdateTimeEntryBody) => Promise<void>;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<EntryFormState>(makeInitialForm(periodStartDate, entry));

  useEffect(() => {
    if (!open) return;
    setForm(makeInitialForm(periodStartDate, entry));
  }, [open, entry, periodStartDate]);

  const selectedHotel = hotels.find((hotel) => String(hotel.id) === form.hotelId);
  const totalAmount = computeTotalAmount(form.hoursWorked, form.ratePerHour, form.flatAmount);

  const updateField = <K extends keyof EntryFormState>(key: K, value: EntryFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleWorkerChange = (workerId: string) => {
    const selectedWorker = workers.find((worker) => String(worker.id) === workerId);
    setForm((current) => ({
      ...current,
      workerId,
      entryType: selectedWorker?.workerType === "subcontractor" ? "subcontractor" : "payroll",
    }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!form.workerId) {
      alert("Please choose a worker.");
      return;
    }

    if (!form.workDate) {
      alert("Please choose the work date.");
      return;
    }

    if (!form.flatAmount.trim() && (!form.hoursWorked.trim() || !form.ratePerHour.trim())) {
      alert("Enter hours and rate, or use a flat amount.");
      return;
    }

    const payload: CreateTimeEntryBody | UpdateTimeEntryBody = {
      workerId: Number(form.workerId),
      hotelId: form.hotelId ? Number(form.hotelId) : null,
      entryType: form.entryType,
      workDate: form.workDate,
      hoursWorked: form.hoursWorked.trim() ? Number(form.hoursWorked) : null,
      ratePerHour: form.ratePerHour.trim() ? Number(form.ratePerHour) : null,
      flatAmount: form.flatAmount.trim() ? Number(form.flatAmount) : null,
      totalAmount,
      notes: form.notes.trim() || null,
      region: selectedHotel?.region ?? null,
    };

    await onSubmit(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onClose} title={entry ? "Edit Hours" : "Add Hours"}>
      {workers.length === 0 ? (
        <div className="space-y-6">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <h3 className="text-xl font-bold text-amber-950 mb-2">No workers available</h3>
            <p className="text-base text-amber-900">Create a worker first, then come back to this pay period to add hours.</p>
          </div>
          <div className="flex justify-end gap-4 border-t border-border pt-6">
            <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : (
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2 md:col-span-2">
            <Label>Worker *</Label>
            <select value={form.workerId} onChange={(event) => handleWorkerChange(event.target.value)} className={SELECT_CLASS} required>
              <option value="">Choose a worker...</option>
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>{worker.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label>Work Date *</Label>
            <Input type="date" value={form.workDate} onChange={(event) => updateField("workDate", event.target.value)} required />
          </div>

          <div className="space-y-2">
            <Label>Type *</Label>
            <select value={form.entryType} onChange={(event) => updateField("entryType", event.target.value as EntryFormState["entryType"])} className={SELECT_CLASS}>
              <option value="payroll">Payroll</option>
              <option value="subcontractor">Subcontractor</option>
            </select>
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>Hotel / Site</Label>
            <select value={form.hotelId} onChange={(event) => updateField("hotelId", event.target.value)} className={SELECT_CLASS}>
              <option value="">No hotel selected</option>
              {hotels.map((hotel) => (
                <option key={hotel.id} value={hotel.id}>{hotel.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label>Hours</Label>
            <Input type="number" min="0" step="0.25" value={form.hoursWorked} onChange={(event) => updateField("hoursWorked", event.target.value)} placeholder="e.g. 8" />
          </div>

          <div className="space-y-2">
            <Label>Rate</Label>
            <Input type="number" min="0" step="0.01" value={form.ratePerHour} onChange={(event) => updateField("ratePerHour", event.target.value)} placeholder="e.g. 20" />
          </div>

          <div className="space-y-2">
            <Label>Flat Amount Override</Label>
            <Input type="number" min="0" step="0.01" value={form.flatAmount} onChange={(event) => updateField("flatAmount", event.target.value)} placeholder="Use instead of hours × rate" />
          </div>

          <div className="space-y-2">
            <Label>Total</Label>
            <Input value={formatCurrency(totalAmount)} readOnly />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>Notes</Label>
            <Input value={form.notes} onChange={(event) => updateField("notes", event.target.value)} placeholder="Optional notes for this entry" />
          </div>
        </div>

        <div className="pt-6 flex justify-end gap-4 border-t border-border">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" isLoading={isSaving}>{entry ? "Save Changes" : "Add Hours"}</Button>
        </div>
      </form>
      )}
    </Dialog>
  );
}
