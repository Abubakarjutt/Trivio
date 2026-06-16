"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useToast } from "@/lib/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Building2, Globe, Sparkles, FileUp, ShieldCheck } from "lucide-react";
import { toast as sonnerToast } from "sonner";

const BUSINESS_TYPES = [
  { value: "SOLE_TRADER", label: "Sole Trader / Freelancer" },
  { value: "PARTNERSHIP", label: "Partnership" },
  { value: "COMPANY", label: "Limited Company" },
  { value: "OTHER", label: "Other" },
];

const MONTHS = [
  { value: "1", label: "January" }, { value: "2", label: "February" },
  { value: "3", label: "March" }, { value: "4", label: "April" },
  { value: "5", label: "May" }, { value: "6", label: "June" },
  { value: "7", label: "July" }, { value: "8", label: "August" },
  { value: "9", label: "September" }, { value: "10", label: "October" },
  { value: "11", label: "November" }, { value: "12", label: "December" },
];

type Step = 1 | 2 | 3;
type UploadState = "idle" | "uploading" | "error";

const PDF_STEP_LABELS: Record<string, string> = {
  extracting:    "Extracting text from PDF",
  parsing:       "Parsing transactions with AI",
  categorizing:  "Categorizing merchants",
  deduplicating: "Checking for duplicates",
  saving:        "Saving to your account",
};

const IMAGE_STEP_LABELS: Record<string, string> = {
  parsing:       "Reading statement image with AI",
  categorizing:  "Categorizing merchants",
  deduplicating: "Checking for duplicates",
  saving:        "Saving to your account",
};

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"];
const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

function getFileCategory(file: File): "csv" | "pdf" | "image" | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return "csv";
  if (name.endsWith(".pdf")) return "pdf";
  if (IMAGE_EXTS.some((ext) => name.endsWith(ext)) || IMAGE_MIME_TYPES.includes(file.type)) return "image";
  return null;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>(1);

  const [step1Data, setStep1Data] = useState({ businessName: "", businessType: "SOLE_TRADER" });
  const [step2Data, setStep2Data] = useState({ currency: "USD", taxRegimeId: "", fiscalYearStartMonth: "1" });

  // Step 3 upload state
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ step: string; pct: number } | null>(null);
  const [uploadCompletedSteps, setUploadCompletedSteps] = useState<string[]>([]);
  const [uploadError, setUploadError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { data: currencies } = trpc.org.getCurrencies.useQuery();
  const { data: taxRegimes } = trpc.org.getTaxRegimes.useQuery();

  const setupStep1 = trpc.org.setupStep1.useMutation({
    onSuccess: () => setStep(2),
    onError: (err) => toast({ variant: "destructive", title: err.message }),
  });

  const setupStep2 = trpc.org.setupStep2.useMutation({
    onSuccess: () => setStep(3),
    onError: (err) => toast({ variant: "destructive", title: err.message }),
  });

  const loadSampleData = trpc.org.loadSampleData.useMutation({
    onSuccess: () => router.push("/dashboard"),
    onError: (err) => toast({ variant: "destructive", title: err.message }),
  });

  const progress = step === 1 ? 33 : step === 2 ? 66 : 100;

  const handleFile = useCallback((f: File) => {
    if (!getFileCategory(f)) {
      sonnerToast.error("Only PDF, CSV, and image files are supported");
      return;
    }
    setUploadFile(f);
    setUploadError("");
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleUpload = async () => {
    if (!uploadFile) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setUploadState("uploading");
    setUploadProgress(null);
    setUploadCompletedSteps([]);

    const formData = new FormData();
    formData.append("file", uploadFile);
    const category = getFileCategory(uploadFile);
    const stepLabels = category === "image" ? IMAGE_STEP_LABELS : PDF_STEP_LABELS;

    if (category === "csv") {
      try {
        const res = await fetch("/api/pf/import", { method: "POST", body: formData, signal: controller.signal });
        const data = await res.json() as { status: string; batchId?: string; count?: number; error?: string };
        if (!res.ok || data.error) throw new Error(data.error ?? "Import failed");
        if (controller.signal.aborted) return;
        if (data.status === "duplicates" && data.batchId) {
          router.push(`/pf/transactions?batch=${data.batchId}`);
        } else if (data.status === "already_imported") {
          sonnerToast.info("All transactions from this file are already in your records.");
          router.push("/dashboard");
        } else {
          router.push("/dashboard");
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        setUploadError(e instanceof Error ? e.message : "Unknown error");
        setUploadState("error");
      }
      return;
    }

    // PDF / image — SSE stream
    try {
      const res = await fetch("/api/pf/import", { method: "POST", body: formData, signal: controller.signal });
      if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let currentEvent = "";
      let terminated = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("event: ")) {
            currentEvent = trimmed.slice(7);
          } else if (trimmed.startsWith("data: ")) {
            try {
              const d = JSON.parse(trimmed.slice(6));
              if (currentEvent === "progress") {
                setUploadProgress(d);
                if (d.step && d.pct > 10) {
                  setUploadCompletedSteps(() => {
                    const steps = Object.keys(stepLabels);
                    const idx = steps.indexOf(d.step as string);
                    return steps.slice(0, idx);
                  });
                }
              } else if (currentEvent === "duplicates") {
                terminated = true;
                if (!controller.signal.aborted) router.push(`/pf/transactions?batch=${d.batchId}`);
                return;
              } else if (currentEvent === "done" || currentEvent === "already_imported") {
                terminated = true;
                if (!controller.signal.aborted) router.push("/dashboard");
                return;
              } else if (currentEvent === "error") {
                throw new Error(d.message ?? "Import error");
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) continue;
              throw parseErr;
            }
            currentEvent = "";
          }
        }
      }
      // Stream ended without a terminal event
      if (!terminated && !controller.signal.aborted) {
        setUploadError("Upload ended unexpectedly. Please try again.");
        setUploadState("error");
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      setUploadError(e instanceof Error ? e.message : "Unknown error");
      setUploadState("error");
    }
  };

  const fileCategory = uploadFile ? getFileCategory(uploadFile) : null;
  const stepLabels = fileCategory === "image" ? IMAGE_STEP_LABELS : PDF_STEP_LABELS;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-lg">A</div>
          <h1 className="text-2xl font-bold">Set up Trivio</h1>
          <p className="text-muted-foreground text-sm">
            {step < 3 ? `Step ${step} of 3 — takes about 2 minutes` : "Step 3 of 3 — choose how to begin"}
          </p>
        </div>

        <Progress value={progress} className="h-2" />

        {/* Step 1: Business Info */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle>Business information</CardTitle>
                  <CardDescription>Tell us a bit about your business</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="businessName">Business name</Label>
                <Input
                  id="businessName"
                  placeholder="e.g. Jane's Design Studio"
                  value={step1Data.businessName}
                  onChange={(e) => setStep1Data((d) => ({ ...d, businessName: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="businessType">Business type</Label>
                <Select
                  value={step1Data.businessType}
                  onValueChange={(v) => setStep1Data((d) => ({ ...d, businessType: v }))}
                >
                  <SelectTrigger id="businessType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BUSINESS_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full"
                disabled={!step1Data.businessName || setupStep1.isPending}
                onClick={() =>
                  setupStep1.mutate({
                    businessName: step1Data.businessName,
                    businessType: step1Data.businessType as "SOLE_TRADER" | "PARTNERSHIP" | "COMPANY" | "OTHER",
                  })
                }
              >
                {setupStep1.isPending && <Loader2 className="animate-spin mr-2" />}
                Continue
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Currency & Tax */}
        {step === 2 && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                  <Globe className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle>Currency & Tax</CardTitle>
                  <CardDescription>Configure your financial settings</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currency">Base currency</Label>
                <Select
                  value={step2Data.currency}
                  onValueChange={(v) => setStep2Data((d) => ({ ...d, currency: v }))}
                >
                  <SelectTrigger id="currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currencies?.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.code} — {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="taxRegime">Tax regime</Label>
                <Select
                  value={step2Data.taxRegimeId}
                  onValueChange={(v) => setStep2Data((d) => ({ ...d, taxRegimeId: v }))}
                >
                  <SelectTrigger id="taxRegime">
                    <SelectValue placeholder="Select your tax regime..." />
                  </SelectTrigger>
                  <SelectContent>
                    {taxRegimes?.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name} ({r.country})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">This determines how tax is calculated on invoices and bills.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fiscalYear">Fiscal year starts</Label>
                <Select
                  value={step2Data.fiscalYearStartMonth}
                  onValueChange={(v) => setStep2Data((d) => ({ ...d, fiscalYearStartMonth: v }))}
                >
                  <SelectTrigger id="fiscalYear">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
                <Button
                  className="flex-1"
                  disabled={!step2Data.taxRegimeId || setupStep2.isPending}
                  onClick={() =>
                    setupStep2.mutate({
                      currency: step2Data.currency,
                      taxRegimeId: step2Data.taxRegimeId || undefined,
                      fiscalYearStartMonth: parseInt(step2Data.fiscalYearStartMonth),
                    })
                  }
                >
                  {setupStep2.isPending && <Loader2 className="animate-spin mr-2" />}
                  Continue
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Get started */}
        {step === 3 && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-lg">
                  🚀
                </div>
                <div>
                  <CardTitle>Get started</CardTitle>
                  <CardDescription>Choose how you&apos;d like to begin</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">

              {/* Option 1: Sample data */}
              <div className="rounded-xl border-2 border-primary p-4 bg-primary/5 space-y-3">
                <div className="flex items-start gap-3">
                  <Sparkles className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-sm">Explore with sample data</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      See the app with realistic invoices, bills, contacts, and journal entries.
                      Cleared automatically when you create your first real transaction.
                    </p>
                  </div>
                </div>
                <Button
                  className="w-full"
                  disabled={loadSampleData.isPending}
                  onClick={() => loadSampleData.mutate()}
                >
                  {loadSampleData.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" />Loading sample data…</>
                  ) : (
                    "Load sample data & explore →"
                  )}
                </Button>
              </div>

              {/* Option 2: Import statement (inline upload) */}
              <div className="rounded-xl border-2 border-border p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <FileUp className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold text-sm">Import my bank statement</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Upload a PDF or image of your bank statement.
                    </p>
                  </div>
                </div>

                {/* Upload area */}
                {uploadState === "idle" && (
                  <>
                    <div
                      onDrop={onDrop}
                      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                      onDragLeave={() => setDragging(false)}
                      onClick={() => fileInputRef.current?.click()}
                      className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 cursor-pointer transition-all
                        ${dragging ? "border-primary bg-primary/5" : uploadFile ? "border-primary/60 bg-primary/5" : "border-muted-foreground/30 hover:border-primary/60 hover:bg-primary/5"}`}
                    >
                      {uploadFile ? (
                        <>
                          <p className="text-sm font-medium text-center break-all">{uploadFile.name}</p>
                          <p className="text-xs text-muted-foreground mt-1">Click to change</p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-medium text-muted-foreground">Drop your statement here</p>
                          <p className="text-xs text-muted-foreground mt-1">or click to browse · PDF, CSV, image</p>
                        </>
                      )}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,.csv,.jpg,.jpeg,.png,.webp,.heic,.heif"
                        className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                      />
                    </div>

                    <div className="flex items-start gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
                      <ShieldCheck className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                      <p className="text-xs text-emerald-700">
                        Account numbers and card details are redacted before any data leaves this app.
                      </p>
                    </div>

                    {uploadFile && (
                      <Button className="w-full" onClick={handleUpload}>
                        Import Transactions
                      </Button>
                    )}
                  </>
                )}

                {/* Upload progress */}
                {uploadState === "uploading" && (
                  <div className="space-y-3 py-2">
                    {Object.entries(stepLabels).map(([key, label], idx) => {
                      const isDone = uploadCompletedSteps.includes(key);
                      const isActive = uploadProgress?.step === key;
                      return (
                        <div key={key} className="flex items-center gap-2">
                          <div className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0
                            ${isDone ? "bg-emerald-500" : isActive ? "bg-primary" : "bg-muted"}`}>
                            {isDone ? (
                              <span className="text-white text-xs">✓</span>
                            ) : isActive ? (
                              <Loader2 className="h-3 w-3 text-white animate-spin" />
                            ) : (
                              <span className="text-muted-foreground text-xs">{idx + 1}</span>
                            )}
                          </div>
                          <p className={`text-xs font-medium ${isDone ? "text-emerald-700" : isActive ? "text-foreground" : "text-muted-foreground"}`}>
                            {label}
                          </p>
                        </div>
                      );
                    })}
                    {uploadProgress && (
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all duration-500"
                          style={{ width: `${uploadProgress.pct}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Upload error */}
                {uploadState === "error" && (
                  <div className="space-y-2">
                    <p className="text-xs text-destructive">{uploadError}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setUploadState("idle"); setUploadError(""); }}
                    >
                      Try again
                    </Button>
                  </div>
                )}
              </div>

              {/* Option 3: Skip */}
              <button
                type="button"
                onClick={() => { abortRef.current?.abort(); router.push("/dashboard"); }}
                className="w-full text-xs text-muted-foreground hover:text-foreground py-2 transition-colors"
              >
                Skip for now — I&apos;ll add data later
              </button>

            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
