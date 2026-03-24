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
                  </td>
                  <td className="p-5">
                    <p className="text-lg font-medium capitalize">{worker.paymentMethod || 'Not set'}</p>
                    {worker.interacEmail && <p className="text-base text-muted-foreground">{worker.interacEmail}</p>}
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
  const queryClient = useQueryClient();
  const create = useCreateWorker({ mutation: { onSuccess: () => { onSuccess(); onClose(); } }});
  const update = useUpdateWorker({ mutation: { onSuccess: () => { onSuccess(); onClose(); } }});

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data: any = {
      name: fd.get("name") as string,
      workerType: fd.get("workerType") as string,
      phone: fd.get("phone") as string || null,
      email: fd.get("email") as string || null,
      paymentMethod: fd.get("paymentMethod") as string || null,
      interacEmail: fd.get("interacEmail") as string || null,
      isActive: fd.get("isActive") === "true",
    };

    if (worker) {
      update.mutate({ id: worker.id, data });
    } else {
      create.mutate({ data });
    }
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
            <Label>Payment Method</Label>
            <select name="paymentMethod" defaultValue={worker?.paymentMethod || "etransfer"} className="flex min-h-[48px] w-full rounded-xl border-2 border-border bg-background px-4 py-2 text-lg focus:border-primary focus:ring-4 outline-none">
              <option value="etransfer">E-Transfer</option>
              <option value="cheque">Cheque</option>
              <option value="cash">Cash</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>Interac Email</Label>
            <Input name="interacEmail" defaultValue={worker?.interacEmail || ""} />
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
