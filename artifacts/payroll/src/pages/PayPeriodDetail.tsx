import { useState } from "react";
import { useGetPayPeriod, useGetPayPeriodTally } from "@workspace/api-client-react";
import { Card, StatusBadge, Button } from "@/components/ui";
import { formatDate, formatCurrency, cn } from "@/lib/utils";
import { Building2, Users, Receipt, Briefcase, FileSpreadsheet, Send, FileDown } from "lucide-react";

export default function PayPeriodDetail({ params }: { params: { id: string } }) {
  const periodId = parseInt(params.id);
  const { data: period, isLoading } = useGetPayPeriod(periodId);
  const [activeTab, setActiveTab] = useState("hotel");

  if (isLoading) return <div className="p-10 text-2xl animate-pulse text-center">Loading workspace...</div>;
  if (!period) return <div className="p-10 text-2xl text-destructive text-center">Pay period not found.</div>;

  const TABS = [
    { id: "hotel", label: "By Hotel", icon: Building2 },
    { id: "worker", label: "By Worker", icon: Users },
    { id: "payroll", label: "Payroll Only", icon: Briefcase },
    { id: "subcon", label: "Subcontractors", icon: Briefcase },
    { id: "tally", label: "Tally", icon: Receipt },
    { id: "payment", label: "Payment Prep", icon: Send },
    { id: "export", label: "Export", icon: FileDown },
  ];

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <Card className="p-8 bg-gradient-to-r from-primary to-primary/80 text-primary-foreground border-none shadow-xl">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <div className="flex items-center gap-4 mb-2">
              <h1 className="text-4xl font-black">{period.name}</h1>
              <span className="bg-white/20 px-3 py-1 rounded-full text-sm font-bold uppercase tracking-wider">
                {period.status.replace('_', ' ')}
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
      </Card>

      {/* Tabs */}
      <div className="flex overflow-x-auto gap-2 pb-2 hide-scrollbar">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-3 px-6 py-4 rounded-2xl font-semibold text-lg transition-all whitespace-nowrap",
              activeTab === tab.id 
                ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25" 
                : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <tab.icon className="w-5 h-5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content Area */}
      <div className="min-h-[500px]">
        {activeTab === "hotel" && <EntriesTable entries={period.entries} groupBy="hotelName" />}
        {activeTab === "worker" && <EntriesTable entries={period.entries} groupBy="workerName" />}
        {activeTab === "payroll" && <EntriesTable entries={period.entries.filter(e => e.entryType === 'payroll')} groupBy="workerName" />}
        {activeTab === "subcon" && <EntriesTable entries={period.entries.filter(e => e.entryType === 'subcontractor')} groupBy="workerName" />}
        {activeTab === "tally" && <TallyTab periodId={period.id} />}
        {activeTab === "payment" && <PaymentPrepTab payments={period.payments} />}
        {activeTab === "export" && <ExportTab periodId={period.id} />}
      </div>
    </div>
  );
}

// Sub-components for Tabs
function EntriesTable({ entries, groupBy }: { entries: any[], groupBy: string }) {
  // Simple grouping
  const grouped = entries.reduce((acc, entry) => {
    const key = entry[groupBy] || 'Unassigned';
    if (!acc[key]) acc[key] = [];
    acc[key].push(entry);
    return acc;
  }, {} as Record<string, any[]>);

  if (entries.length === 0) return <Card className="p-10 text-center text-xl text-muted-foreground">No entries found.</Card>;

  return (
    <div className="space-y-8">
      {(Object.entries(grouped) as [string, any[]][]).map(([groupName, groupEntries]) => {
        const groupTotal = groupEntries.reduce((sum: number, e: any) => sum + Number(e.totalAmount), 0);
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
                    <th className="p-4 font-semibold text-muted-foreground">Worker / Hotel</th>
                    <th className="p-4 font-semibold text-muted-foreground">Type</th>
                    <th className="p-4 font-semibold text-muted-foreground text-right">Hours</th>
                    <th className="p-4 font-semibold text-muted-foreground text-right">Rate</th>
                    <th className="p-4 font-semibold text-muted-foreground text-right">Total</th>
                    <th className="p-4 font-semibold text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {groupEntries.map(entry => (
                    <tr key={entry.id} className="border-t hover:bg-accent/30">
                      <td className="p-4 font-medium">
                        {groupBy === 'hotelName' ? entry.workerName : (entry.hotelName || 'N/A')}
                      </td>
                      <td className="p-4 capitalize text-muted-foreground">{entry.entryType}</td>
                      <td className="p-4 text-right">{entry.hoursWorked || '-'}</td>
                      <td className="p-4 text-right">{entry.ratePerHour ? formatCurrency(entry.ratePerHour) : '-'}</td>
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
          {tally.byHotel.map(h => (
            <div key={h.hotelName} className="flex justify-between border-b pb-2">
              <span>{h.hotelName} <span className="text-muted-foreground ml-2">({h.workerCount} workers)</span></span>
              <span className="font-bold">{formatCurrency(h.totalAmount)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-xl font-bold mb-4">By Region</h3>
        <div className="space-y-3">
          {tally.byRegion.map(r => (
            <div key={r.region} className="flex justify-between border-b pb-2">
              <span className="font-semibold">{r.region}</span>
              <span className="font-bold text-primary">{formatCurrency(r.totalAmount)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function PaymentPrepTab({ payments }: { payments: any[] }) {
  const etransfers = payments.filter(p => p.paymentMethod === 'etransfer');
  const cheques = payments.filter(p => p.paymentMethod === 'cheque');

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
            {etransfers.map(p => (
              <tr key={p.id} className="border-t">
                <td className="p-4 font-semibold">{p.workerName}</td>
                <td className="p-4 text-primary">{p.interacEmail || 'MISSING'}</td>
                <td className="p-4 font-bold text-right">{formatCurrency(p.amount)}</td>
                <td className="p-4"><StatusBadge status={p.status} /></td>
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
            {cheques.map(p => (
              <tr key={p.id} className="border-t">
                <td className="p-4 font-semibold">{p.workerName}</td>
                <td className="p-4 font-bold text-right">{formatCurrency(p.amount)}</td>
                <td className="p-4"><StatusBadge status={p.status} /></td>
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
    window.open(`/api/pay-periods/${periodId}/export?type=${type}`, '_blank');
  };
  
  return (
    <Card className="p-8">
      <h3 className="text-3xl font-bold mb-8">Export & Reports</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Button onClick={() => handleExport('payroll')} variant="outline" className="h-20 text-lg flex justify-start px-6 gap-4">
          <FileSpreadsheet className="w-8 h-8 text-primary" /> Payroll CSV
        </Button>
        <Button onClick={() => handleExport('subcontractors')} variant="outline" className="h-20 text-lg flex justify-start px-6 gap-4">
          <FileSpreadsheet className="w-8 h-8 text-primary" /> Subcontractors CSV
        </Button>
        <Button onClick={() => handleExport('etransfer')} variant="outline" className="h-20 text-lg flex justify-start px-6 gap-4">
          <FileSpreadsheet className="w-8 h-8 text-indigo-500" /> E-Transfer List
        </Button>
        <Button onClick={() => handleExport('cheque')} variant="outline" className="h-20 text-lg flex justify-start px-6 gap-4">
          <FileSpreadsheet className="w-8 h-8 text-emerald-500" /> Cheque List
        </Button>
        <Button onClick={() => handleExport('tally')} variant="outline" className="h-20 text-lg flex justify-start px-6 gap-4">
          <FileSpreadsheet className="w-8 h-8 text-slate-500" /> Tally Report
        </Button>
      </div>
    </Card>
  );
}
