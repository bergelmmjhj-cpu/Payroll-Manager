import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, MapPin, CheckCircle, XCircle, AlertCircle, ClockIcon, Send } from "lucide-react";
import { Card, Button, StatusBadge } from "@/components/ui";
import { useGetMe } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

// ─── Types ───────────────────────────────────────────────────────────────────

type ShiftStatus = "open" | "pending_approval" | "approved" | "rejected" | "correction_requested";

interface ShiftLog {
  id: number;
  workerId: number;
  hotelId: number;
  clockInAt: string | null;
  clockOutAt: string | null;
  status: ShiftStatus;
  submittedAt: string | null;
  clockInDistanceMeters: string | null;
  clockOutDistanceMeters: string | null;
  notes: string | null;
  timeEntryId: number | null;
}

interface Hotel {
  id: number;
  name: string;
}

interface CorrectionRequest {
  id: number;
  shiftLogId: number;
  reason: string;
  status: string;
  requestedClockIn: string | null;
  requestedClockOut: string | null;
  createdAt: string;
}

// ─── Geo helper ──────────────────────────────────────────────────────────────

function getLocation(): Promise<GeolocationCoordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by your browser"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      () => reject(new Error("Location access denied. Please enable GPS and try again.")),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  });
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Status badge helper ──────────────────────────────────────────────────────

const STATUS_LABELS: Record<ShiftStatus, string> = {
  open: "in_progress",
  pending_approval: "pending",
  approved: "approved",
  rejected: "missing_info",
  correction_requested: "review",
};

function formatDuration(inAt: string | null, outAt: string | null): string {
  if (!inAt) return "—";
  const start = new Date(inAt).getTime();
  const end   = outAt ? new Date(outAt).getTime() : Date.now();
  const mins  = Math.floor((end - start) / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function formatTime(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Timecard() {
  const { data: user } = useGetMe();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedHotelId, setSelectedHotelId] = useState<number | "">("");
  const [correctionTarget, setCorrectionTarget] = useState<ShiftLog | null>(null);
  const [correctionForm, setCorrectionForm] = useState({ requestedClockIn: "", requestedClockOut: "", reason: "" });

  // ── Queries ──

  const { data: hotels = [] } = useQuery<Hotel[]>({
    queryKey: ["hotels-list"],
    queryFn: () => apiFetch<Hotel[]>("/hotels"),
  });

  const { data: activeShift, refetch: refetchActive } = useQuery<ShiftLog | null>({
    queryKey: ["timelog-active"],
    queryFn: () => apiFetch<ShiftLog | null>("/timelog/active"),
    refetchInterval: 30_000, // poll every 30 s
  });

  const { data: myLogs = [], refetch: refetchLogs } = useQuery<ShiftLog[]>({
    queryKey: ["timelog-my-logs"],
    queryFn: () => apiFetch<ShiftLog[]>("/timelog/my-logs"),
  });

  const { data: myCorrections = [] } = useQuery<CorrectionRequest[]>({
    queryKey: ["timelog-my-corrections"],
    queryFn: () => apiFetch<CorrectionRequest[]>("/timelog/my-corrections"),
  });

  const refetchAll = useCallback(() => {
    refetchActive();
    refetchLogs();
    qc.invalidateQueries({ queryKey: ["timelog-my-corrections"] });
  }, [refetchActive, refetchLogs, qc]);

  // ── Clock In ──

  const clockIn = useMutation({
    mutationFn: async () => {
      const coords = await getLocation();
      return apiFetch("/timelog/clock-in", {
        method: "POST",
        body: JSON.stringify({ hotelId: selectedHotelId, latitude: coords.latitude, longitude: coords.longitude }),
      });
    },
    onSuccess: () => { toast({ title: "Clocked in successfully" }); refetchAll(); },
    onError: (e: Error) => toast({ title: "Clock-in failed", description: e.message, variant: "destructive" }),
  });

  // ── Clock Out ──

  const clockOut = useMutation({
    mutationFn: async () => {
      const coords = await getLocation();
      return apiFetch("/timelog/clock-out", {
        method: "POST",
        body: JSON.stringify({ latitude: coords.latitude, longitude: coords.longitude }),
      });
    },
    onSuccess: () => { toast({ title: "Clocked out successfully" }); refetchAll(); },
    onError: (e: Error) => toast({ title: "Clock-out failed", description: e.message, variant: "destructive" }),
  });

  // ── Submit ──

  const submit = useMutation({
    mutationFn: (id: number) => apiFetch(`/timelog/${id}/submit`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Shift submitted for approval" }); refetchAll(); },
    onError: (e: Error) => toast({ title: "Submit failed", description: e.message, variant: "destructive" }),
  });

  // ── Correction request ──

  const submitCorrection = useMutation({
    mutationFn: ({ id, ...body }: { id: number; requestedClockIn?: string; requestedClockOut?: string; reason: string }) =>
      apiFetch(`/timelog/${id}/correction`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast({ title: "Correction request submitted" });
      setCorrectionTarget(null);
      setCorrectionForm({ requestedClockIn: "", requestedClockOut: "", reason: "" });
      refetchAll();
    },
    onError: (e: Error) => toast({ title: "Failed to submit correction", description: e.message, variant: "destructive" }),
  });

  // ── Render ──

  const isWorker = !!user?.workerId;

  if (!isWorker) {
    return (
      <div className="p-8 space-y-4">
        <h1 className="text-3xl font-bold">My Timecard</h1>
        <Card className="p-6 text-center text-muted-foreground">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-yellow-500" />
          <p className="text-lg font-medium">Your account is not linked to a worker record.</p>
          <p className="text-sm mt-2">Contact your administrator to link your Google account to your worker profile.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div>
        <h1 className="text-4xl font-extrabold tracking-tight">My Timecard</h1>
        <p className="text-xl text-muted-foreground mt-2">Clock in, clock out, and track your shifts.</p>
      </div>

      {/* ── Clock In / Out Panel ── */}
      <Card className="p-6 space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Clock className="w-5 h-5" />
          {activeShift ? "Active Shift" : "Start a Shift"}
        </h2>

        {activeShift ? (
          <div className="space-y-4">
            <div className="flex items-center gap-4 p-4 bg-primary/5 rounded-xl">
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">Current hotel</p>
                <p className="font-semibold">{hotels.find(h => h.id === activeShift.hotelId)?.name ?? `Hotel #${activeShift.hotelId}`}</p>
              </div>
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">Clocked in</p>
                <p className="font-semibold">{formatTime(activeShift.clockInAt)}</p>
              </div>
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">Duration</p>
                <p className="font-semibold text-primary">{formatDuration(activeShift.clockInAt, null)}</p>
              </div>
            </div>
            {activeShift.clockInDistanceMeters && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Clocked in {activeShift.clockInDistanceMeters} m from workplace
              </p>
            )}
            <Button
              onClick={() => clockOut.mutate()}
              isLoading={clockOut.isPending}
              variant="danger"
              className="w-full gap-2"
            >
              <XCircle className="w-5 h-5" /> Clock Out
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-muted-foreground block mb-1">Select workplace</label>
              <select
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={selectedHotelId}
                onChange={(e) => setSelectedHotelId(Number(e.target.value) || "")}
              >
                <option value="">— Choose a hotel —</option>
                {hotels.filter(h => (h as any).isActive !== false).map(h => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </div>
            <Button
              onClick={() => clockIn.mutate()}
              isLoading={clockIn.isPending}
              disabled={!selectedHotelId}
              className="w-full gap-2"
            >
              <CheckCircle className="w-5 h-5" /> Clock In
            </Button>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Your GPS location will be verified when you clock in.
            </p>
          </div>
        )}
      </Card>

      {/* ── Correction Request Modal ── */}
      {correctionTarget && (
        <Card className="p-6 space-y-4 border-yellow-400 bg-yellow-50/30">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-yellow-600" /> Request Correction
          </h2>
          <p className="text-sm text-muted-foreground">
            Shift on {formatDate(correctionTarget.clockInAt)} — original times:{" "}
            {formatTime(correctionTarget.clockInAt)} → {formatTime(correctionTarget.clockOutAt)}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Correct clock-in</label>
              <input
                type="datetime-local"
                className="w-full mt-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={correctionForm.requestedClockIn}
                onChange={e => setCorrectionForm(f => ({ ...f, requestedClockIn: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Correct clock-out</label>
              <input
                type="datetime-local"
                className="w-full mt-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                value={correctionForm.requestedClockOut}
                onChange={e => setCorrectionForm(f => ({ ...f, requestedClockOut: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Reason (required)</label>
            <textarea
              className="w-full mt-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              rows={3}
              placeholder="Explain the correction needed…"
              value={correctionForm.reason}
              onChange={e => setCorrectionForm(f => ({ ...f, reason: e.target.value }))}
            />
          </div>
          <div className="flex gap-3">
            <Button
              onClick={() => submitCorrection.mutate({
                id: correctionTarget.id,
                reason: correctionForm.reason,
                requestedClockIn:  correctionForm.requestedClockIn  || undefined,
                requestedClockOut: correctionForm.requestedClockOut || undefined,
              })}
              isLoading={submitCorrection.isPending}
              disabled={!correctionForm.reason}
              className="gap-2"
            >
              <Send className="w-4 h-4" /> Submit Request
            </Button>
            <Button variant="outline" onClick={() => setCorrectionTarget(null)}>Cancel</Button>
          </div>
        </Card>
      )}

      {/* ── Shift History ── */}
      <div className="space-y-3">
        <h2 className="text-2xl font-bold">Shift History</h2>
        {myLogs.length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground">
            <ClockIcon className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No shifts recorded yet.</p>
          </Card>
        ) : (
          myLogs.map((log) => {
            const correction = myCorrections.find(c => c.shiftLogId === log.id);
            return (
              <Card key={log.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <p className="font-semibold text-sm">
                      {formatDate(log.clockInAt)} — {hotels.find(h => h.id === log.hotelId)?.name ?? `Hotel #${log.hotelId}`}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatTime(log.clockInAt)} → {formatTime(log.clockOutAt)}
                      {log.clockOutAt && (
                        <span className="ml-2 font-medium text-foreground">{formatDuration(log.clockInAt, log.clockOutAt)}</span>
                      )}
                    </p>
                  </div>
                  <StatusBadge status={STATUS_LABELS[log.status]} />
                </div>

                {log.timeEntryId && (
                  <p className="text-xs text-emerald-600">✓ Promoted to payroll entry #{log.timeEntryId}</p>
                )}

                {correction && (
                  <div className="text-xs bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                    <span className="font-medium">Correction requested</span> — {correction.reason}{" "}
                    <span className="text-muted-foreground">({correction.status})</span>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 flex-wrap">
                  {log.status === "open" && log.clockOutAt && (
                    <Button
                      variant="outline"
                      className="gap-1 text-sm min-h-[36px] px-4"
                      isLoading={submit.isPending}
                      onClick={() => submit.mutate(log.id)}
                    >
                      <Send className="w-3 h-3" /> Submit for Approval
                    </Button>
                  )}
                  {["pending_approval", "approved", "rejected"].includes(log.status) && !correction && (
                    <Button
                      variant="outline"
                      className="gap-1 text-sm min-h-[36px] px-4 text-yellow-700 border-yellow-300 hover:bg-yellow-50"
                      onClick={() => {
                        setCorrectionTarget(log);
                        setCorrectionForm({ requestedClockIn: "", requestedClockOut: "", reason: "" });
                      }}
                    >
                      <AlertCircle className="w-3 h-3" /> Request Correction
                    </Button>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
