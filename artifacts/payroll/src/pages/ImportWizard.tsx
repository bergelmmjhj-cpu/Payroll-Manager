import { useState } from "react";
import { useAnalyzeImport, useConfirmImport } from "@workspace/api-client-react";
import { Card, Button } from "@/components/ui";
import { UploadCloud, CheckCircle2, AlertTriangle, FileSpreadsheet, ArrowRight } from "lucide-react";
import { useLocation } from "wouter";

export default function ImportWizard() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(1);
  const [fileData, setFileData] = useState("");
  const [fileName, setFileName] = useState("");
  
  const analyze = useAnalyzeImport();
  const confirm = useConfirmImport({
    mutation: { onSuccess: (res) => setLocation(`/pay-periods/${res.periodId}`) }
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = (event.target?.result as string).split(',')[1];
      setFileData(base64);
      analyze.mutate({ data: { fileData: base64, fileName: file.name } });
      setStep(2);
    };
    reader.readAsDataURL(file);
  };

  const analysis = analyze.data;

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in slide-in-from-bottom-4">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-black mb-4">Optional Excel Import</h1>
        <p className="text-xl text-muted-foreground">Use this only when you already have a workbook. Day-to-day payroll entry should happen inside each pay period.</p>
      </div>

      <Card className="p-6 bg-amber-50 border-amber-200">
        <h2 className="text-2xl font-bold text-amber-950 mb-2">Recommended workflow</h2>
        <p className="text-lg text-amber-900">Create or open a pay period, then click Add Hours to enter worker hours directly in the app.</p>
      </Card>

      {step === 1 && (
        <Card className="p-16 border-dashed border-4 border-primary/20 bg-primary/5 flex flex-col items-center justify-center text-center relative overflow-hidden transition-colors hover:border-primary/50 hover:bg-primary/10">
          <UploadCloud className="w-24 h-24 text-primary mb-6 animate-bounce" style={{animationDuration: '3s'}} />
          <h3 className="text-2xl font-bold text-foreground mb-2">Drag & drop workbook</h3>
          <p className="text-lg text-muted-foreground mb-8">Supports existing MMJ .xlsx files when you need a bulk import.</p>
          <div className="relative">
            <Button className="text-xl h-16 px-10 shadow-xl relative z-10 pointer-events-none">
              Browse Files
            </Button>
            <input 
              type="file" 
              accept=".xlsx,.xls" 
              onChange={handleFileChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20" 
            />
          </div>
        </Card>
      )}

      {step === 2 && analyze.isPending && (
        <Card className="p-16 text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
          <h2 className="text-2xl font-bold">Analyzing Workbook...</h2>
          <p className="text-lg text-muted-foreground">Scanning all sheets and extracting data.</p>
        </Card>
      )}

      {step === 2 && analysis && (
        <div className="space-y-6">
          <Card className="p-8 bg-emerald-50 border-emerald-200">
            <div className="flex items-center gap-4 mb-6">
              <CheckCircle2 className="w-10 h-10 text-emerald-600" />
              <div>
                <h2 className="text-2xl font-bold text-emerald-900">Analysis Complete</h2>
                <p className="text-lg text-emerald-700">Found {analysis.entryCount} entries across {analysis.workerCount} workers ready for bulk import.</p>
              </div>
            </div>
            <div className="bg-white p-4 rounded-xl border mb-6 flex justify-between items-center">
              <span className="font-semibold text-lg">{analysis.detectedPeriodName || 'Unknown Period'}</span>
              <span className="text-muted-foreground">{analysis.detectedStartDate} to {analysis.detectedEndDate}</span>
            </div>
            <Button 
              className="w-full h-16 text-xl bg-emerald-600 hover:bg-emerald-700" 
              onClick={() => confirm.mutate({
                data: {
                  fileData,
                  periodName: analysis.detectedPeriodName || fileName,
                  startDate: analysis.detectedStartDate,
                  endDate: analysis.detectedEndDate,
                  sheetsToImport: analysis.sheets.filter(s => s.recognized).map(s => s.name)
                }
              })}
              isLoading={confirm.isPending}
            >
              Confirm & Import Everything <ArrowRight className="ml-2 w-6 h-6" />
            </Button>
          </Card>

          <h3 className="text-2xl font-bold mt-10 mb-4">Detected Sheets</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {analysis.sheets.map((sheet, i) => (
              <Card key={i} className="p-4 flex items-center gap-3">
                <FileSpreadsheet className={sheet.recognized ? "text-primary" : "text-muted-foreground"} />
                <div className="flex-1 overflow-hidden">
                  <p className="font-semibold truncate">{sheet.name}</p>
                  <p className="text-sm text-muted-foreground">{sheet.rowCount} rows</p>
                </div>
                {sheet.recognized ? <CheckCircle2 className="text-emerald-500 w-5 h-5" /> : <AlertTriangle className="text-amber-500 w-5 h-5" />}
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
