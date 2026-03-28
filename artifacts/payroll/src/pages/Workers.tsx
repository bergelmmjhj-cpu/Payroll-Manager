import { useState } from "react";
import {
  useListWorkers,
  useCreateWorker,
  useUpdateWorker,
  useDeleteWorker,
  useSyncWorkers,
  getListWorkersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, Button, Input, StatusBadge, Dialog, Label } from "@/components/ui";
import { Plus, Search, Edit2, Trash2, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { Worker, CreateWorkerBody, UpdateWorkerBody } from "@workspace/api-client-react";

type PaymentMethodKind = "direct_deposit" | "etransfer" | "cheque" | "cash" | "other" | "not_set";

function normalizeValue(value: FormDataEntryValue | string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePaymentMethodKind(value: string | null | undefined): PaymentMethodKind {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return "not_set";
  if (["direct deposit", "direct_deposit", "direct-deposit"].includes(normalized)) return "direct_deposit";
  if (["e-transfer", "etransfer", "e_transfer", "interac"].includes(normalized)) return "etransfer";
  if (normalized === "cheque") return "cheque";
  if (normalized === "cash") return "cash";
  return "other";
}

function hasBankDetails(worker: Worker): boolean {
  return Boolean(
    worker.bankName ||
      worker.institutionNumber ||
      worker.transitNumber ||
      worker.accountNumber ||
      worker.bankAccount,
  );
}

function resolvePrimaryPayment(worker: Worker): { label: string; methodKind: PaymentMethodKind } {
  const methodKind = normalizePaymentMethodKind(worker.paymentMethod);
  const hasInterac = Boolean(worker.interacEmail);
  const hasBank = hasBankDetails(worker);

  if (methodKind === "direct_deposit") return { label: "Direct Deposit", methodKind };
  if (methodKind === "etransfer") return { label: "E-Transfer", methodKind };
  if (methodKind === "cheque") return { label: "Cheque", methodKind };
  if (methodKind === "cash") return { label: "Cash", methodKind };
  if (methodKind === "other") return { label: worker.paymentMethod ?? "Not set", methodKind };

  if (hasInterac) {
    return { label: "E-Transfer", methodKind: "etransfer" };
  }

  if (hasBank) {
    return { label: "Direct Deposit", methodKind: "direct_deposit" };
  }

  return { label: "Not set", methodKind: "not_set" };
}

function renderBankSummary(worker: Worker): string | null {
  const accountNumber = worker.accountNumber ?? worker.bankAccount;
  const parts = [
    worker.bankName ? `Bank: ${worker.bankName}` : null,
    worker.institutionNumber ? `Institution: ${worker.institutionNumber}` : null,
    worker.transitNumber ? `Transit: ${worker.transitNumber}` : null,
    accountNumber ? `Account: ${accountNumber}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" | ") : null;
}

export default function Workers() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const { data: workers, isLoading } = useListWorkers({ search: search || undefined });
  
  const [isEditing, setIsEditing] = useState<Worker | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListWorkersQueryKey() });
  
  const deleteWorker = useDeleteWorker({ mutation: { onSuccess: invalidate }});
  const syncWorkers = useSyncWorkers({
    mutation: {
      onSuccess: async (result: any) => {
        await invalidate();
        toast({
          title: "Workers synced",
          description: result?.message || "Workers directory updated successfully.",
        });
      },
      onError: (error: any) => {
        toast({
          title: "Worker sync failed",
          description: error?.response?.data?.error || error?.message || "Unable to sync workers.",
        });
      },
    },
  });

  const handleDelete = async (id: number) => {
    if (confirm("Are you sure you want to delete this worker?")) {
      await deleteWorker.mutateAsync({ id });
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-4xl font-extrabold">Workers Directory</h1>
          <p className="text-xl text-muted-foreground mt-2">Manage your payroll staff and subcontractors.</p>
        </div>
        <div className="flex gap-4">
          <Button onClick={() => syncWorkers.mutate()} variant="outline" className="gap-2" isLoading={syncWorkers.isPending}>
            <RefreshCw className="w-5 h-5" /> Sync Workers
          </Button>
          <Button onClick={() => setIsCreating(true)} className="gap-2">
            <Plus className="w-5 h-5" /> Add Worker
          </Button>
        </div>
      </div>

      <Card className="p-4 flex gap-4 bg-secondary/20">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground w-6 h-6" />
          <Input 
            placeholder="Search by name, phone or email..." 
            className="pl-12 text-lg h-14"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </Card>

      <Card className="overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-secondary/80 border-b">
                <th className="p-5 text-lg font-semibold text-muted-foreground">Name & Contact</th>
                <th className="p-5 text-lg font-semibold text-muted-foreground">Type</th>
                <th className="p-5 text-lg font-semibold text-muted-foreground">Payment Info</th>
                <th className="p-5 text-lg font-semibold text-muted-foreground">Status</th>
                <th className="p-5 text-lg font-semibold text-muted-foreground text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={5} className="p-10 text-center text-xl animate-pulse">Loading workers...</td></tr>}
              {workers?.map(worker => (
                <tr key={worker.id} className="border-b last:border-0 hover:bg-accent/30 transition-colors">
                  <td className="p-5">
                    <p className="text-xl font-bold text-foreground">{worker.name}</p>
                    <p className="text-base text-muted-foreground mt-1">{worker.phone || worker.email || 'No contact info'}</p>
                  </td>
                  <td className="p-5">
                    <span className="inline-flex items-center px-3 py-1 rounded-full bg-indigo-100 text-indigo-800 font-semibold text-sm capitalize">
                      {worker.workerType}
                    </span>
                    {worker.defaultRate != null && (
                      <p className="mt-2 text-sm font-medium text-muted-foreground">Default rate {worker.defaultRate.toFixed(2)}/hr</p>
                    )}
                  </td>
                  <td className="p-5">
                    {(() => {
                      const primary = resolvePrimaryPayment(worker);
                      const bankSummary = renderBankSummary(worker);
                      const showInteracAsSecondary = primary.methodKind !== "etransfer" && Boolean(worker.interacEmail);
                      const showBankAsSecondary = primary.methodKind !== "direct_deposit" && Boolean(bankSummary);

                      return (
                        <>
                          <p className="text-lg font-medium">{primary.label}</p>
                          {primary.methodKind === "direct_deposit" && bankSummary && (
                            <p className="text-base text-muted-foreground">{bankSummary}</p>
                          )}
                          {primary.methodKind === "etransfer" && worker.interacEmail && (
                            <p className="text-base text-muted-foreground">{worker.interacEmail}</p>
                          )}
                          {showInteracAsSecondary && (
                            <p className="text-sm text-muted-foreground">Also on file: E-Transfer {worker.interacEmail}</p>
                          )}
                          {showBankAsSecondary && (
                            <p className="text-sm text-muted-foreground">Also on file: Direct Deposit {bankSummary}</p>
                          )}
                        </>
                      );
                    })()}
                  </td>
                  <td className="p-5">
                    <StatusBadge status={worker.isActive ? 'ready' : 'draft'} />
                  </td>
                  <td className="p-5 text-right space-x-2">
                    <Button variant="outline" onClick={() => setIsEditing(worker)} className="px-3">
                      <Edit2 className="w-5 h-5" />
                    </Button>
                    <Button variant="danger" onClick={() => handleDelete(worker.id)} className="px-3">
                      <Trash2 className="w-5 h-5" />
                    </Button>
                  </td>
                </tr>
              ))}
              {!isLoading && workers?.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-12 text-center">
                    <div className="max-w-xl mx-auto space-y-4">
                      <h2 className="text-2xl font-bold text-foreground">No workers added yet</h2>
                      <p className="text-lg text-muted-foreground">Add your first worker manually or sync workers from your configured source so pay periods can accept hours entries.</p>
                      <div className="flex flex-wrap justify-center gap-3">
                        <Button onClick={() => syncWorkers.mutate()} variant="outline" className="gap-2" isLoading={syncWorkers.isPending}>
                          <RefreshCw className="w-5 h-5" /> Sync Workers
                        </Button>
                        <Button onClick={() => setIsCreating(true)} className="gap-2">
                          <Plus className="w-5 h-5" /> Add First Worker
                        </Button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <WorkerModal 
        open={isCreating || !!isEditing} 
        onClose={() => { setIsCreating(false); setIsEditing(null); }}
        worker={isEditing}
        onSuccess={invalidate}
      />
    </div>
  );
}

function WorkerModal({ open, onClose, worker, onSuccess }: { open: boolean, onClose: () => void, worker: Worker | null, onSuccess: () => void }) {
  const create = useCreateWorker({ mutation: { onSuccess: () => { onSuccess(); onClose(); } }});
  const update = useUpdateWorker({ mutation: { onSuccess: () => { onSuccess(); onClose(); } }});

  const paymentMethodValue = worker?.paymentMethod ?? "";
  const standardPaymentMethods = ["", "Direct Deposit", "E-Transfer", "cheque", "cash"];
  const hasCustomPaymentMethod = Boolean(paymentMethodValue) && !standardPaymentMethods.includes(paymentMethodValue);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const paymentMethod = normalizeValue(fd.get("paymentMethod"));
    const accountNumber = normalizeValue(fd.get("accountNumber"));
    const name = (fd.get("name") as string).trim();
    const workerType = (fd.get("workerType") as "payroll" | "subcontractor") ?? "payroll";

    const commonData = {
      name,
      workerType,
      phone: normalizeValue(fd.get("phone")),
      email: normalizeValue(fd.get("email")),
      defaultRate: fd.get("defaultRate") ? Number(fd.get("defaultRate")) : null,
      paymentMethod,
      interacEmail: normalizeValue(fd.get("interacEmail")),
      bankName: normalizeValue(fd.get("bankName")),
      institutionNumber: normalizeValue(fd.get("institutionNumber")),
      transitNumber: normalizeValue(fd.get("transitNumber")),
      accountNumber,
      bankAccount: accountNumber,
    };

    if (worker) {
      const data: UpdateWorkerBody = {
        ...commonData,
        isActive: fd.get("isActive") === "true",
      };
      update.mutate({ id: worker.id, data });
      return;
    }

    const data: CreateWorkerBody = commonData;
    create.mutate({ data });
  };

  return (
    <Dialog open={open} onOpenChange={onClose} title={worker ? "Edit Worker" : "Add Worker"}>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label>Full Name *</Label>
            <Input name="name" defaultValue={worker?.name} required />
          </div>
          <div className="space-y-2">
            <Label>Worker Type *</Label>
            <select name="workerType" defaultValue={worker?.workerType || "payroll"} className="flex min-h-[48px] w-full rounded-xl border-2 border-border bg-background px-4 py-2 text-lg focus:border-primary focus:ring-4 outline-none">
              <option value="payroll">Payroll</option>
              <option value="subcontractor">Subcontractor</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input name="phone" defaultValue={worker?.phone || ""} />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" name="email" defaultValue={worker?.email || ""} />
          </div>
          <div className="space-y-2">
            <Label>Default Rate</Label>
            <Input type="number" min="0" step="0.01" name="defaultRate" defaultValue={worker?.defaultRate ?? ""} />
          </div>
          <div className="space-y-2">
            <Label>Payment Method</Label>
            <select name="paymentMethod" defaultValue={paymentMethodValue} className="flex min-h-[48px] w-full rounded-xl border-2 border-border bg-background px-4 py-2 text-lg focus:border-primary focus:ring-4 outline-none">
              <option value="">Not set</option>
              <option value="Direct Deposit">Direct Deposit</option>
              <option value="E-Transfer">E-Transfer</option>
              <option value="cheque">Cheque</option>
              <option value="cash">Cash</option>
              {hasCustomPaymentMethod && (
                <option value={paymentMethodValue}>{paymentMethodValue}</option>
              )}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Interac Email</Label>
            <Input name="interacEmail" defaultValue={worker?.interacEmail || ""} />
          </div>
          <div className="space-y-2">
            <Label>Bank Name</Label>
            <Input name="bankName" defaultValue={worker?.bankName || ""} />
          </div>
          <div className="space-y-2">
            <Label>Institution #</Label>
            <Input name="institutionNumber" defaultValue={worker?.institutionNumber || ""} />
          </div>
          <div className="space-y-2">
            <Label>Transit #</Label>
            <Input name="transitNumber" defaultValue={worker?.transitNumber || ""} />
          </div>
          <div className="space-y-2">
            <Label>Account #</Label>
            <Input name="accountNumber" defaultValue={worker?.accountNumber || worker?.bankAccount || ""} />
          </div>
          {worker && (
            <div className="space-y-2">
              <Label>Status</Label>
              <select name="isActive" defaultValue={worker?.isActive ? "true" : "false"} className="flex min-h-[48px] w-full rounded-xl border-2 border-border bg-background px-4 py-2 text-lg focus:border-primary focus:ring-4 outline-none">
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>
          )}
        </div>
        <div className="pt-6 flex justify-end gap-4 border-t border-border">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" isLoading={create.isPending || update.isPending}>
            {worker ? "Save Changes" : "Create Worker"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
