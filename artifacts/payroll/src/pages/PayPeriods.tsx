import { useState } from "react";
import { useListPayPeriods, useCreatePayPeriod, useDeletePayPeriod, getListPayPeriodsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, Button, Input, StatusBadge, Dialog, Label } from "@/components/ui";
import { Plus, Calendar, ArrowRight, Trash2, UploadCloud } from "lucide-react";
import { formatDate, formatCurrency } from "@/lib/utils";
import { useLocation } from "wouter";

export default function PayPeriods() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: periods, isLoading } = useListPayPeriods();
  const [isCreating, setIsCreating] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListPayPeriodsQueryKey() });
  const deletePeriod = useDeletePayPeriod({ mutation: { onSuccess: invalidate }});

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this entire pay period? This action cannot be undone.")) {
      await deletePeriod.mutateAsync({ id });
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-4xl font-extrabold">Pay Periods</h1>
          <p className="text-xl text-muted-foreground mt-2">Open a pay period and enter worker hours directly in the app.</p>
        </div>
        <div className="flex gap-4">
          <Button onClick={() => setLocation('/import')} variant="outline" className="gap-2 bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100">
            <UploadCloud className="w-5 h-5" /> Optional Excel Import
          </Button>
          <Button onClick={() => setIsCreating(true)} className="gap-2">
            <Plus className="w-5 h-5" /> New Pay Period
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {isLoading && <div className="p-10 text-xl text-center animate-pulse">Loading periods...</div>}
        {periods?.map(period => (
          <Card 
            key={period.id} 
            className="p-6 hover:shadow-2xl hover:-translate-y-1 transition-all cursor-pointer border-l-8 border-l-primary"
            onClick={() => setLocation(`/pay-periods/${period.id}`)}
          >
            <div className="flex flex-col md:flex-row justify-between md:items-center gap-6">
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold text-foreground">{period.name}</h2>
                  <StatusBadge status={period.status} />
                </div>
                <div className="flex items-center gap-2 text-lg text-muted-foreground">
                  <Calendar className="w-5 h-5" />
                  {formatDate(period.startDate)} — {formatDate(period.endDate)}
                </div>
              </div>

              <div className="flex items-center gap-8 bg-secondary/50 p-4 rounded-2xl">
                <div>
                  <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Grand Total</p>
                  <p className="text-3xl font-black text-foreground">{formatCurrency(period.totalGrand)}</p>
                </div>
                <div className="flex flex-col gap-2">
                  <Button variant="ghost" className="bg-white hover:bg-primary/10 hover:text-primary rounded-xl px-4">
                    Open & Add Hours <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                  <Button variant="ghost" onClick={(e) => handleDelete(period.id, e)} className="text-destructive hover:bg-destructive/10 text-sm h-10">
                    <Trash2 className="w-4 h-4 mr-2" /> Delete
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        ))}
        {periods?.length === 0 && (
          <Card className="p-12 text-center border-dashed border-4 border-border bg-transparent shadow-none">
            <h3 className="text-2xl font-bold text-muted-foreground mb-4">No pay periods found</h3>
            <Button onClick={() => setIsCreating(true)}>Create your first pay period</Button>
          </Card>
        )}
      </div>

      <CreatePeriodModal open={isCreating} onClose={() => setIsCreating(false)} onSuccess={invalidate} />
    </div>
  );
}

function CreatePeriodModal({ open, onClose, onSuccess }: { open: boolean, onClose: () => void, onSuccess: () => void }) {
  const create = useCreatePayPeriod({ mutation: { onSuccess: () => { onSuccess(); onClose(); } }});

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    create.mutate({
      data: {
        name: fd.get("name") as string,
        startDate: fd.get("startDate") as string,
        endDate: fd.get("endDate") as string,
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose} title="Create Pay Period">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label>Period Name *</Label>
          <Input name="name" placeholder="e.g. March 1-15 2024" required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Start Date *</Label>
            <Input type="date" name="startDate" required />
          </div>
          <div className="space-y-2">
            <Label>End Date *</Label>
            <Input type="date" name="endDate" required />
          </div>
        </div>
        <div className="pt-6 flex justify-end gap-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" isLoading={create.isPending}>Create Period</Button>
        </div>
      </form>
    </Dialog>
  );
}
