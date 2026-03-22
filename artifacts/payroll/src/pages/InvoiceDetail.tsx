import { useState, useEffect } from "react";
import { useGetInvoice, useListBusinessProfiles, useCreateInvoice, useUpdateInvoice } from "@workspace/api-client-react";
import { Card, Button, Input, Label } from "@/components/ui";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Printer, Save, Plus, Trash2, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

export default function InvoiceDetail({ params }: { params: { id: string } }) {
  const [, setLocation] = useLocation();
  const isNew = params.id === "new";
  
  // Data hooks
  const { data: profiles } = useListBusinessProfiles();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingInvoice, isLoading: isLoadingInvoice } = useGetInvoice(isNew ? 0 : parseInt(params.id), { query: { enabled: !isNew } as any });

  const createInv = useCreateInvoice({ mutation: { onSuccess: (res) => setLocation(`/invoices/${res.id}`) }});
  const updateInv = useUpdateInvoice();

  // Local State for live preview
  const [formState, setFormState] = useState({
    businessProfileId: null as number | null,
    invoiceNumber: `INV-${new Date().getFullYear()}-${Math.floor(Math.random()*1000)}`,
    clientName: "",
    clientAddress: "",
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: "",
    serviceDescription: "Cleaning and Janitorial Services",
    notes: "Please make payment via E-Transfer to info@mmj.com",
    taxRate: 13, // Default HST
  });

  const [lineItems, setLineItems] = useState([{ id: 1, description: "", hours: 0, rate: 0, amount: 0, sortOrder: 1 }]);

  // Sync loaded data to state
  useEffect(() => {
    if (existingInvoice && !isNew) {
      setFormState({
        businessProfileId: existingInvoice.businessProfileId || null,
        invoiceNumber: existingInvoice.invoiceNumber,
        clientName: existingInvoice.clientName,
        clientAddress: existingInvoice.clientAddress || "",
        invoiceDate: existingInvoice.invoiceDate,
        dueDate: existingInvoice.dueDate || "",
        serviceDescription: existingInvoice.serviceDescription || "",
        notes: existingInvoice.notes || "",
        taxRate: existingInvoice.taxRate || 0,
      });
      setLineItems(existingInvoice.lineItems.map(li => ({ ...li, hours: li.hours || 0, rate: li.rate || 0 })));
    } else if (profiles && profiles.length > 0 && isNew) {
      // Set default profile
      const def = profiles.find(p => p.isDefault) || profiles[0];
      setFormState(prev => ({ ...prev, businessProfileId: def.id }));
    }
  }, [existingInvoice, isNew, profiles]);

  // Calculations
  const subtotal = lineItems.reduce((sum, item) => sum + (item.amount || 0), 0);
  const taxAmount = subtotal * ((formState.taxRate || 0) / 100);
  const total = subtotal + taxAmount;
  
  const selectedProfile = profiles?.find(p => p.id === formState.businessProfileId) || profiles?.[0];

  const handleSave = () => {
    const payload = {
      ...formState,
      lineItems: lineItems.map((li, i) => ({
        description: li.description,
        hours: li.hours || null,
        rate: li.rate || null,
        amount: li.amount,
        sortOrder: i
      }))
    };
    if (isNew) {
      createInv.mutate({ data: payload });
    } else {
      updateInv.mutate({ id: parseInt(params.id), data: payload });
    }
  };

  const updateLineItem = (index: number, field: string, value: any) => {
    const newItems = [...lineItems];
    newItems[index] = { ...newItems[index], [field]: value };
    // Auto-calculate amount if hours and rate exist
    if (field === 'hours' || field === 'rate') {
      const h = Number(newItems[index].hours) || 0;
      const r = Number(newItems[index].rate) || 0;
      if (h > 0 && r > 0) newItems[index].amount = h * r;
    }
    setLineItems(newItems);
  };

  if (!isNew && isLoadingInvoice) return <div className="p-10 text-xl animate-pulse">Loading invoice...</div>;

  return (
    <div className="flex flex-col xl:flex-row gap-8 min-h-[calc(100vh-8rem)]">
      
      {/* LEFT: EDITOR FORM (Hidden on print) */}
      <div className="w-full xl:w-1/2 space-y-6 no-print">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => setLocation('/invoices')} className="px-0 hover:bg-transparent -ml-2">
            <ArrowLeft className="w-5 h-5 mr-2" /> Back to Invoices
          </Button>
          <div className="space-x-4">
            <Button variant="outline" onClick={() => window.print()} className="gap-2 border-primary text-primary">
              <Printer className="w-5 h-5" /> Print PDF
            </Button>
            <Button onClick={handleSave} className="gap-2 bg-emerald-600 hover:bg-emerald-700" isLoading={createInv.isPending || updateInv.isPending}>
              <Save className="w-5 h-5" /> Save Invoice
            </Button>
          </div>
        </div>

        <Card className="p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2">
              <Label>Business Profile (Sender)</Label>
              <select 
                className="w-full rounded-xl border-2 p-3 text-lg"
                value={formState.businessProfileId || ''}
                onChange={e => setFormState({...formState, businessProfileId: parseInt(e.target.value)})}
              >
                {profiles?.map(p => <option key={p.id} value={p.id}>{p.businessName}</option>)}
              </select>
            </div>
            
            <div className="space-y-2">
              <Label>Invoice Number</Label>
              <Input value={formState.invoiceNumber} onChange={e => setFormState({...formState, invoiceNumber: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>Invoice Date</Label>
              <Input type="date" value={formState.invoiceDate} onChange={e => setFormState({...formState, invoiceDate: e.target.value})} />
            </div>

            <div className="space-y-2 col-span-2">
              <Label>Client/Hotel Name *</Label>
              <Input value={formState.clientName} onChange={e => setFormState({...formState, clientName: e.target.value})} placeholder="e.g. Grand Hotel Downtown" />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Client Address</Label>
              <textarea 
                className="w-full rounded-xl border-2 p-3 min-h-[100px] text-lg"
                value={formState.clientAddress} 
                onChange={e => setFormState({...formState, clientAddress: e.target.value})}
              />
            </div>
          </div>

          <div className="border-t pt-6">
            <Label className="text-xl mb-4 block">Line Items</Label>
            <div className="space-y-4">
              {lineItems.map((item, i) => (
                <div key={i} className="flex gap-2 items-start bg-secondary/30 p-3 rounded-xl">
                  <div className="flex-1 space-y-2">
                    <Input placeholder="Description..." value={item.description} onChange={e => updateLineItem(i, 'description', e.target.value)} />
                    <div className="flex gap-2">
                      <Input type="number" placeholder="Hours" value={item.hours || ''} onChange={e => updateLineItem(i, 'hours', parseFloat(e.target.value))} />
                      <Input type="number" placeholder="Rate" value={item.rate || ''} onChange={e => updateLineItem(i, 'rate', parseFloat(e.target.value))} />
                      <Input type="number" placeholder="Amount" value={item.amount || ''} onChange={e => updateLineItem(i, 'amount', parseFloat(e.target.value))} className="font-bold bg-primary/5 border-primary/20" />
                    </div>
                  </div>
                  <Button variant="ghost" className="text-destructive h-full py-4 mt-1" onClick={() => setLineItems(lineItems.filter((_, idx) => idx !== i))}>
                    <Trash2 className="w-5 h-5" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" onClick={() => setLineItems([...lineItems, { id: Math.random(), description: "", hours: 0, rate: 0, amount: 0, sortOrder: 0 }])} className="w-full border-dashed border-2">
                <Plus className="w-5 h-5 mr-2" /> Add Line
              </Button>
            </div>
          </div>

          <div className="border-t pt-6 grid grid-cols-2 gap-4">
             <div className="space-y-2">
                <Label>Tax Rate (%)</Label>
                <Input type="number" value={formState.taxRate} onChange={e => setFormState({...formState, taxRate: parseFloat(e.target.value)})} />
             </div>
             <div className="space-y-2 col-span-2">
                <Label>Notes / Payment Instructions</Label>
                <textarea 
                  className="w-full rounded-xl border-2 p-3 min-h-[100px] text-lg"
                  value={formState.notes} 
                  onChange={e => setFormState({...formState, notes: e.target.value})}
                />
             </div>
          </div>
        </Card>
      </div>

      {/* RIGHT: LIVE PREVIEW (Full width on print) */}
      <div className="w-full xl:w-1/2 invoice-preview-container flex-shrink-0 relative">
        <div className="sticky top-8">
          <Card className="p-10 bg-white text-black min-h-[1056px] shadow-2xl rounded-none md:rounded-2xl mx-auto max-w-[816px] print:shadow-none print:min-h-0 print:p-0 border-0 ring-1 ring-black/5">
            
            {/* Invoice Header */}
            <div className="flex justify-between items-start border-b-2 border-slate-100 pb-8 mb-8">
              <div className="max-w-[50%]">
                {selectedProfile?.logoUrl ? (
                  <img src={selectedProfile.logoUrl} alt="Logo" className="max-h-24 object-contain mb-4" />
                ) : (
                  <h1 className="text-3xl font-black text-slate-800 mb-2">{selectedProfile?.businessName || 'Your Business Name'}</h1>
                )}
                <div className="text-slate-500 whitespace-pre-wrap text-sm leading-relaxed">
                  {selectedProfile?.address}<br/>
                  {selectedProfile?.phone} | {selectedProfile?.email}<br/>
                  {selectedProfile?.hstNumber && `HST: ${selectedProfile.hstNumber}`}
                </div>
              </div>
              <div className="text-right">
                <h2 className="text-5xl font-black text-slate-200 tracking-tighter uppercase mb-4">Invoice</h2>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-right text-sm">
                  <span className="font-semibold text-slate-500">Invoice #</span>
                  <span className="font-bold text-slate-800">{formState.invoiceNumber || 'INV-000'}</span>
                  <span className="font-semibold text-slate-500">Date</span>
                  <span className="text-slate-800">{formatDate(formState.invoiceDate)}</span>
                </div>
              </div>
            </div>

            {/* Bill To */}
            <div className="mb-10">
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2">Billed To</h3>
              <p className="text-xl font-bold text-slate-800">{formState.clientName || 'Client Name'}</p>
              <p className="text-slate-600 whitespace-pre-wrap mt-1">{formState.clientAddress}</p>
            </div>

            {/* Table */}
            <table className="w-full text-left mb-8">
              <thead>
                <tr className="border-y-2 border-slate-800 text-sm">
                  <th className="py-3 font-bold text-slate-800 uppercase tracking-wider">Description</th>
                  <th className="py-3 font-bold text-slate-800 uppercase tracking-wider text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lineItems.map((item, i) => (
                  <tr key={i}>
                    <td className="py-4">
                      <p className="font-semibold text-slate-800">{item.description || 'Item description'}</p>
                      {(item.hours || item.rate) ? (
                        <p className="text-sm text-slate-500 mt-1">{item.hours} hrs @ {formatCurrency(item.rate)}/hr</p>
                      ) : null}
                    </td>
                    <td className="py-4 font-bold text-slate-800 text-right">{formatCurrency(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div className="flex justify-end border-t-2 border-slate-100 pt-6">
              <div className="w-1/2 min-w-[250px]">
                <div className="flex justify-between py-2 text-slate-600">
                  <span>Subtotal</span>
                  <span className="font-semibold">{formatCurrency(subtotal)}</span>
                </div>
                {formState.taxRate > 0 && (
                  <div className="flex justify-between py-2 text-slate-600">
                    <span>Tax ({formState.taxRate}%)</span>
                    <span className="font-semibold">{formatCurrency(taxAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between py-4 text-xl font-black text-slate-800 border-t-2 border-slate-800 mt-2">
                  <span>Total Due</span>
                  <span>{formatCurrency(total)}</span>
                </div>
              </div>
            </div>

            {/* Notes */}
            {formState.notes && (
              <div className="mt-16 pt-8 border-t border-slate-100">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-2">Notes & Payment Instructions</h3>
                <p className="text-slate-600 whitespace-pre-wrap">{formState.notes}</p>
              </div>
            )}
            
          </Card>
        </div>
      </div>
    </div>
  );
}
