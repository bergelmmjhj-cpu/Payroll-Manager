import { useGetDashboardStats, useSyncWorkers, useSyncHotels } from "@workspace/api-client-react";
import { Card, StatusBadge, Button } from "@/components/ui";
import { Users, Building2, CalendarDays, Receipt, RefreshCw, Plus, ArrowRight } from "lucide-react";
import { Link, useLocation } from "wouter";
import { formatDate } from "@/lib/utils";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { data: stats, isLoading, refetch } = useGetDashboardStats();
  const syncWorkers = useSyncWorkers({ mutation: { onSuccess: () => refetch() }});
  const syncHotels = useSyncHotels({ mutation: { onSuccess: () => refetch() }});

  if (isLoading) return <div className="p-8 text-2xl font-semibold animate-pulse">Loading dashboard...</div>;
  if (!stats) return <div className="p-8 text-xl text-destructive">Failed to load stats.</div>;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-4xl font-extrabold text-foreground tracking-tight">Dashboard</h1>
        <p className="text-xl text-muted-foreground mt-2">Welcome to MMJ Operations. Here's what's happening.</p>
      </div>

      {/* Action Row */}
      <div className="flex flex-wrap gap-4">
        <Button onClick={() => setLocation('/pay-periods')} className="gap-2">
          <Plus className="w-5 h-5" /> New Pay Period
        </Button>
        <Button onClick={() => setLocation('/invoices/new')} variant="outline" className="gap-2">
          <Receipt className="w-5 h-5" /> Create Invoice
        </Button>
        <Button onClick={() => syncWorkers.mutate()} variant="outline" className="gap-2" isLoading={syncWorkers.isPending}>
          <RefreshCw className="w-5 h-5" /> Sync Workers
        </Button>
        <Button onClick={() => syncHotels.mutate()} variant="outline" className="gap-2" isLoading={syncHotels.isPending}>
          <RefreshCw className="w-5 h-5" /> Sync Hotels
        </Button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="p-6 bg-gradient-to-br from-card to-secondary/30 hover:shadow-xl transition-shadow">
          <div className="flex items-center gap-4 text-primary mb-4">
            <div className="p-3 bg-primary/10 rounded-xl"><Users className="w-8 h-8" /></div>
            <h3 className="text-xl font-semibold text-muted-foreground">Workers</h3>
          </div>
          <p className="text-5xl font-black">{stats.totalWorkers}</p>
        </Card>
        
        <Card className="p-6 bg-gradient-to-br from-card to-secondary/30 hover:shadow-xl transition-shadow">
          <div className="flex items-center gap-4 text-emerald-600 mb-4">
            <div className="p-3 bg-emerald-100 rounded-xl"><Building2 className="w-8 h-8" /></div>
            <h3 className="text-xl font-semibold text-muted-foreground">Hotels</h3>
          </div>
          <p className="text-5xl font-black text-emerald-900">{stats.totalHotels}</p>
        </Card>

        <Card className="p-6 bg-gradient-to-br from-card to-secondary/30 hover:shadow-xl transition-shadow">
          <div className="flex items-center gap-4 text-indigo-600 mb-4">
            <div className="p-3 bg-indigo-100 rounded-xl"><CalendarDays className="w-8 h-8" /></div>
            <h3 className="text-xl font-semibold text-muted-foreground">Active Periods</h3>
          </div>
          <p className="text-5xl font-black text-indigo-900">{stats.activePayPeriods}</p>
        </Card>

        <Card className="p-6 bg-gradient-to-br from-card to-secondary/30 hover:shadow-xl transition-shadow">
          <div className="flex items-center gap-4 text-amber-600 mb-4">
            <div className="p-3 bg-amber-100 rounded-xl"><Receipt className="w-8 h-8" /></div>
            <h3 className="text-xl font-semibold text-muted-foreground">Draft Invoices</h3>
          </div>
          <p className="text-5xl font-black text-amber-900">{stats.draftInvoices}</p>
        </Card>
      </div>

      {/* Recent Pay Periods */}
      <div>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-3xl font-bold">Recent Pay Periods</h2>
          <Link href="/pay-periods" className="text-primary font-semibold text-lg flex items-center gap-2 hover:underline">
            View All <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
        
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-secondary/50 border-b">
                  <th className="p-5 text-lg font-semibold text-muted-foreground">Period Name</th>
                  <th className="p-5 text-lg font-semibold text-muted-foreground">Dates</th>
                  <th className="p-5 text-lg font-semibold text-muted-foreground">Status</th>
                  <th className="p-5 text-lg font-semibold text-muted-foreground text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentPayPeriods.map(period => (
                  <tr key={period.id} className="border-b last:border-0 hover:bg-accent/50 transition-colors">
                    <td className="p-5 text-xl font-medium">{period.name}</td>
                    <td className="p-5 text-lg text-muted-foreground">{formatDate(period.startDate)} - {formatDate(period.endDate)}</td>
                    <td className="p-5"><StatusBadge status={period.status} /></td>
                    <td className="p-5 text-right">
                      <Button onClick={() => setLocation(`/pay-periods/${period.id}`)} variant="outline">
                        Open Workspace
                      </Button>
                    </td>
                  </tr>
                ))}
                {stats.recentPayPeriods.length === 0 && (
                  <tr><td colSpan={4} className="p-10 text-center text-xl text-muted-foreground">No recent pay periods found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
