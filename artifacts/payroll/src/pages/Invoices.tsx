import { useListInvoices } from "@workspace/api-client-react";
import { Card, Button, StatusBadge } from "@/components/ui";
import { Plus, Receipt } from "lucide-react";
import { formatDate, formatCurrency } from "@/lib/utils";
import { Link, useLocation } from "wouter";

export default function Invoices() {
  const [, setLocation] = useLocation();
  const { data: invoices, isLoading } = useListInvoices();

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-4xl font-extrabold">Invoices</h1>
          <p className="text-xl text-muted-foreground mt-2">Manage billing and print beautiful invoices.</p>
        </div>
        <Button onClick={() => setLocation('/invoices/new')} className="gap-2">
          <Plus className="w-5 h-5" /> Create Invoice
        </Button>
      </div>

      <Card className="overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-secondary/80 border-b">
                <th className="p-5 text-lg font-semibold text-muted-foreground">Invoice #</th>
                <th className="p-5 text-lg font-semibold text-muted-foreground">Client</th>
                <th className="p-5 text-lg font-semibold text-muted-foreground">Date</th>
                <th className="p-5 text-lg font-semibold text-muted-foreground text-right">Amount</th>
                <th className="p-5 text-lg font-semibold text-muted-foreground">Status</th>
                <th className="p-5 text-lg font-semibold text-muted-foreground text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="p-10 text-center text-xl animate-pulse">Loading invoices...</td></tr>}
              {invoices?.map(inv => (
                <tr key={inv.id} className="border-b last:border-0 hover:bg-accent/30 transition-colors">
                  <td className="p-5 font-bold text-lg">{inv.invoiceNumber}</td>
                  <td className="p-5">
                    <p className="text-xl font-bold text-foreground">{inv.clientName}</p>
                    <p className="text-sm text-muted-foreground line-clamp-1 max-w-[200px]">{inv.clientAddress}</p>
                  </td>
                  <td className="p-5 text-lg text-muted-foreground">{formatDate(inv.invoiceDate)}</td>
                  <td className="p-5 text-right font-black text-xl">{formatCurrency(inv.total)}</td>
                  <td className="p-5"><StatusBadge status={inv.status} /></td>
                  <td className="p-5 text-right">
                    <Button variant="outline" onClick={() => setLocation(`/invoices/${inv.id}`)}>
                      Open
                    </Button>
                  </td>
                </tr>
              ))}
              {invoices?.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-16 text-center text-xl text-muted-foreground">
                    <Receipt className="w-16 h-16 mx-auto mb-4 opacity-20" />
                    No invoices generated yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
