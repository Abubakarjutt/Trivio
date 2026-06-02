"use client";

import { useState, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, CheckCircle2, XCircle, Image as ImageIcon, BookmarkCheck, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

type ImportState = "idle" | "uploading" | "duplicates" | "done" | "already_imported" | "error";
type FileCategory = "csv" | "pdf" | "image";

interface DuplicateItem { date: string | Date; amount: number; description: string; }
interface ProgressStep { step: string; pct: number; count?: number; }

const PDF_STEP_LABELS: Record<string, string> = {
  extracting:    "Extracting text from PDF",
  parsing:       "Parsing transactions",
  categorizing:  "Categorizing with AI",
  deduplicating: "Checking for duplicates",
  saving:        "Saving transactions",
};

const IMAGE_STEP_LABELS: Record<string, string> = {
  parsing:       "Reading statement image with AI",
  categorizing:  "Categorizing with AI",
  deduplicating: "Checking for duplicates",
  saving:        "Saving transactions",
};

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"];

function getFileCategory(file: File): FileCategory | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return "csv";
  if (name.endsWith(".pdf")) return "pdf";
  const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
  if (IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext)) || IMAGE_MIME_TYPES.includes(file.type)) return "image";
  return null;
}

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
  emailImportToken?: string | null;
}

export function ImportDialog({ open, onOpenChange, onComplete, emailImportToken }: ImportDialogProps) {
  const [state, setState]               = useState<ImportState>("idle");
  const [file, setFile]                 = useState<File | null>(null);
  const [dragging, setDragging]         = useState(false);
  const [progress, setProgress]         = useState<ProgressStep | null>(null);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [duplicates, setDuplicates]     = useState<DuplicateItem[]>([]);
  const [batchId, setBatchId]           = useState<string | null>(null);
  const [resultCount, setResultCount]   = useState(0);
  const [skipDuplicates, setSkipDuplicates] = useState(false);
  const [errorMsg, setErrorMsg]         = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setState("idle");
    setFile(null);
    setProgress(null);
    setCompletedSteps([]);
    setDuplicates([]);
    setBatchId(null);
    setResultCount(0);
    setSkipDuplicates(false);
    setErrorMsg("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFile = (f: File) => {
    if (!getFileCategory(f)) {
      toast.error("Only PDF, CSV, and image files (JPEG, PNG, WEBP, HEIC) are supported");
      return;
    }
    setFile(f);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  const handleImport = async () => {
    if (!file) return;
    setState("uploading");
    setCompletedSteps([]);
    setProgress(null);

    const formData = new FormData();
    formData.append("file", file);

    const category = getFileCategory(file);
    if (!category) {
      setErrorMsg("Unsupported file type. Please upload a PDF, CSV, or image.");
      setState("error");
      return;
    }

    if (category === "csv") {
      try {
        const res = await fetch("/api/pf/import", { method: "POST", body: formData });
        const data = await res.json() as { status: string; batchId?: string; count?: number; duplicates?: DuplicateItem[]; error?: string };
        if (!res.ok || data.error) throw new Error(data.error ?? "Import failed");

        if (data.status === "duplicates" && data.batchId && data.duplicates) {
          setBatchId(data.batchId);
          setDuplicates(data.duplicates);
          setState("duplicates");
        } else {
          setResultCount(data.count ?? 0);
          setState("done");
          onComplete();
          toast.success(`${data.count} transactions imported`);
        }
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "Unknown error");
        setState("error");
      }
      return;
    }

    // PDF and image: SSE stream
    const stepLabels = category === "image" ? IMAGE_STEP_LABELS : PDF_STEP_LABELS;

    try {
      const res = await fetch("/api/pf/import", { method: "POST", body: formData });
      if (!res.ok) { throw new Error(`Upload failed: ${res.statusText}`); }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let currentEvent = "";

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
                setProgress(d as ProgressStep);
                if (d.step && d.pct > 10) {
                  setCompletedSteps(() => {
                    const steps = Object.keys(stepLabels);
                    const currentIdx = steps.indexOf(d.step as string);
                    return steps.slice(0, currentIdx);
                  });
                }
              } else if (currentEvent === "duplicates") {
                setBatchId(d.batchId);
                setDuplicates(d.items ?? []);
                setState("duplicates");
              } else if (currentEvent === "done") {
                setResultCount(d.count ?? 0);
                setState("done");
                onComplete();
                toast.success(`${d.count} transactions imported`);
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
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Unknown error");
      setState("error");
    }
  };

  const handleConfirm = async (skip: boolean) => {
    if (!batchId) return;
    setSkipDuplicates(skip);
    setState("uploading");
    setCompletedSteps([]);
    setProgress(null);
    try {
      const url = `/api/pf/import/${batchId}/confirm?skip=${skip}`;
      const res = await fetch(url, { method: "POST" });
      const data = await res.json() as { count: number; skipped: number };
      setResultCount(data.count);
      onComplete();
      if (data.count === 0 && skip) {
        setState("already_imported");
      } else {
        setState("done");
        toast.success(`${data.count} transactions imported${data.skipped ? `, ${data.skipped} duplicates skipped` : ""}`);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Unknown error");
      setState("error");
    }
  };

  const activeStepLabels = file && getFileCategory(file) === "image" ? IMAGE_STEP_LABELS : PDF_STEP_LABELS;
  const activeStepKeys = Object.keys(activeStepLabels);
  const fileCategory = file ? getFileCategory(file) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {state === "duplicates"       ? "Possible Duplicates Found" :
             state === "done"             ? "Import Complete" :
             state === "already_imported" ? "Already Imported" :
             state === "error"            ? "Import Failed" : "Import Statement"}
          </DialogTitle>
        </DialogHeader>

        {/* IDLE */}
        {state === "idle" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">Upload a bank or credit card statement (PDF, CSV, or photo).</p>
            <div
              onDrop={onDrop}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onClick={() => inputRef.current?.click()}
              className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors
                ${dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"}`}
            >
              {fileCategory === "image"
                ? <ImageIcon className="h-8 w-8 text-muted-foreground/40 mb-2" />
                : <Upload className="h-8 w-8 text-muted-foreground/40 mb-2" />
              }
              {file ? (
                <p className="text-sm font-medium">{file.name}</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">Drop PDF, CSV, or image here</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">JPEG · PNG · WEBP · PDF · CSV · max 20 MB</p>
                </>
              )}
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.csv,.jpg,.jpeg,.png,.webp,.heic,.heif"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </div>

            {/* Privacy notice */}
            <div className="flex items-start gap-2 rounded-lg bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800 px-3 py-2.5">
              <ShieldCheck className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-emerald-700 dark:text-emerald-400 leading-relaxed">
                <span className="font-semibold">Privacy:</span>{" "}
                Your account number, IBAN, card number, and contact details are automatically
                redacted before any data leaves this app. Only transaction rows are sent to AI for parsing.
              </p>
            </div>

            {/* Email auto-import banner */}
            {emailImportToken && (
              <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-green-50 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm">⚡</span>
                  <div>
                    <p className="text-xs font-bold text-blue-800">Auto-import via Email</p>
                    <p className="text-[11px] text-blue-600">Set up once — transactions arrive automatically</p>
                  </div>
                </div>
                <p className="text-[11px] text-gray-500 mb-1.5">Forward bank alert emails to:</p>
                <div className="flex items-center justify-between rounded-md border border-blue-200 bg-white px-2.5 py-1.5">
                  <span className="font-mono text-[11px] text-blue-700 truncate">
                    {emailImportToken}@import.trivio-ai.com
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(`${emailImportToken}@import.trivio-ai.com`);
                      toast.success("Copied!");
                    }}
                    className="ml-2 text-[11px] font-semibold text-blue-600 hover:text-blue-800 flex-shrink-0"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={!file} onClick={handleImport}>Import</Button>
            </div>
          </div>
        )}

        {/* UPLOADING / PROCESSING */}
        {state === "uploading" && (
          <div className="flex flex-col gap-4">
            {fileCategory === "csv" ? (
              <div className="flex items-center gap-3 py-4">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Importing CSV…</p>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-3">
                  {activeStepKeys.map((key, idx) => {
                    const isDone = completedSteps.includes(key);
                    const isActive = progress?.step === key;
                    const isPending = !isDone && !isActive;
                    return (
                      <div key={key} className="flex items-center gap-3">
                        <div className={`h-5 w-5 rounded-full flex items-center justify-center text-xs flex-shrink-0
                          ${isDone ? "bg-emerald-500 text-white" : isActive ? "bg-primary" : "bg-muted border"}`}>
                          {isDone ? <CheckCircle2 className="h-3 w-3" /> :
                           isActive ? <Loader2 className="h-3 w-3 animate-spin text-white" /> :
                           <span className="text-muted-foreground">{idx + 1}</span>}
                        </div>
                        <div>
                          <p className={`text-sm ${isPending ? "text-muted-foreground" : "text-foreground"}`}>{activeStepLabels[key]}</p>
                          {isActive && progress?.count && <p className="text-xs text-primary">{progress.count} transactions found</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {progress && (
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progress.pct}%` }} />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* DUPLICATES */}
        {state === "duplicates" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{duplicates.length} transaction{duplicates.length !== 1 ? "s" : ""} may already exist in your records.</p>
            <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
              {duplicates.map((d, i) => (
                <div key={i} className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-3 py-2">
                  <div>
                    <p className="text-sm font-medium">{d.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
                    </p>
                  </div>
                  <p className="text-sm font-medium text-red-500">−${Number(d.amount).toFixed(2)}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <Button variant="outline" onClick={() => handleConfirm(true)}>
                Skip duplicates — import new transactions only
              </Button>
              <Button onClick={() => handleConfirm(false)}>
                Import all — keep duplicates
              </Button>
            </div>
          </div>
        )}

        {/* DONE */}
        {state === "done" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            <div className="text-center">
              <p className="font-medium">{resultCount} transaction{resultCount !== 1 ? "s" : ""} imported</p>
              <p className="text-sm text-muted-foreground mt-1">Categories have been auto-assigned. Edit any row in the table.</p>
            </div>
            <Button onClick={() => { onOpenChange(false); reset(); }}>View Transactions</Button>
          </div>
        )}

        {/* ALREADY IMPORTED */}
        {state === "already_imported" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <BookmarkCheck className="h-12 w-12 text-blue-500" />
            <div className="text-center">
              <p className="font-medium">Already in your records</p>
              <p className="text-sm text-muted-foreground mt-1">
                All transactions in this statement were already imported. Nothing was added.
              </p>
            </div>
            <Button onClick={() => { onOpenChange(false); reset(); }}>View Transactions</Button>
          </div>
        )}

        {/* ERROR */}
        {state === "error" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <XCircle className="h-12 w-12 text-red-500" />
            <div className="text-center">
              <p className="font-medium text-red-500">Import failed</p>
              <p className="text-sm text-muted-foreground mt-1">{errorMsg}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button onClick={reset}>Try again</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
