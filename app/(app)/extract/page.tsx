"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useToast } from "@/lib/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  Upload,
  FileText,
  Image as ImageIcon,
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import type { ExtractionResult } from "@/server/services/extraction.service";

type UploadState = "idle" | "uploading" | "polling" | "done" | "failed";

const MAX_SIZE_MB = 10;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const POLL_INTERVAL_MS = 2000;

function ConfidenceBadge({ value }: { value: number }) {
  if (value >= 0.8) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
        <CheckCircle2 className="h-2.5 w-2.5" />
        {Math.round(value * 100)}%
      </span>
    );
  }
  if (value >= 0.5) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        <AlertTriangle className="h-2.5 w-2.5" />
        {Math.round(value * 100)}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
      <XCircle className="h-2.5 w-2.5" />
      {Math.round(value * 100)}%
    </span>
  );
}

function ExtractionSummary({
  result,
  attachmentId,
}: {
  result: ExtractionResult;
  attachmentId: string;
}) {
  const router = useRouter();
  const conf = result.confidence;

  const labelClass = "text-xs text-muted-foreground font-medium uppercase tracking-wide";
  const valueClass = "text-sm font-medium";

  function Field({
    label,
    value,
    confKey,
  }: {
    label: string;
    value: string | number | null | undefined;
    confKey: string;
  }) {
    const confVal = conf[confKey];
    return (
      <div className="flex items-start justify-between gap-4 py-2">
        <div>
          <p className={labelClass}>{label}</p>
          <p className={cn(valueClass, !value && "text-muted-foreground italic")}>
            {value != null && value !== "" ? String(value) : "—"}
          </p>
        </div>
        {confVal != null && <ConfidenceBadge value={confVal} />}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="h-4 w-4 text-primary" />
        <span>AI extraction complete — please review before saving</span>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Document Details</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <Field label="Supplier" value={result.supplierName} confKey="supplierName" />
          <Field label="Supplier Email" value={result.supplierEmail} confKey="supplierEmail" />
          <Field label="Invoice Number" value={result.invoiceNumber} confKey="invoiceNumber" />
          <Field label="Invoice Date" value={result.invoiceDate} confKey="invoiceDate" />
          <Field label="Due Date" value={result.dueDate} confKey="dueDate" />
          <Field label="Currency" value={result.currency} confKey="currency" />
          <Field label="Notes" value={result.notes} confKey="notes" />
        </CardContent>
      </Card>

      {result.lineItems.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Line Items</CardTitle>
              {conf.lineItems != null && <ConfidenceBadge value={conf.lineItems} />}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="grid grid-cols-12 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 pb-1 border-b gap-2">
                <span className="col-span-5">Description</span>
                <span className="col-span-2 text-right">Qty</span>
                <span className="col-span-2 text-right">Unit Price</span>
                <span className="col-span-3 text-right">Amount</span>
              </div>
              {result.lineItems.map((item, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 text-sm">
                  <span className="col-span-5 truncate">{item.description}</span>
                  <span className="col-span-2 text-right tabular-nums">{item.quantity}</span>
                  <span className="col-span-2 text-right tabular-nums">
                    {item.unitPrice.toFixed(2)}
                  </span>
                  <span className="col-span-3 text-right tabular-nums font-medium">
                    {item.amount.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <div className="flex items-center gap-2">
              <span className="tabular-nums">{result.subtotal?.toFixed(2) ?? "—"}</span>
              {conf.subtotal != null && <ConfidenceBadge value={conf.subtotal} />}
            </div>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tax</span>
            <div className="flex items-center gap-2">
              <span className="tabular-nums">{result.taxAmount?.toFixed(2) ?? "—"}</span>
              {conf.taxAmount != null && <ConfidenceBadge value={conf.taxAmount} />}
            </div>
          </div>
          <Separator />
          <div className="flex justify-between font-semibold text-base">
            <span>Total</span>
            <div className="flex items-center gap-2">
              <span className="tabular-nums">
                {result.currency ?? ""} {result.totalAmount?.toFixed(2) ?? "—"}
              </span>
              {conf.totalAmount != null && <ConfidenceBadge value={conf.totalAmount} />}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3 pt-1">
        <Button
          className="flex-1"
          onClick={() => router.push(`/invoices/new?extractionId=${attachmentId}`)}
        >
          <FileText className="mr-2 h-4 w-4" />
          Create Invoice
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => router.push(`/bills/new?extractionId=${attachmentId}`)}
        >
          <FileText className="mr-2 h-4 w-4" />
          Create Bill
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default function ExtractPage() {
  const { toast } = useToast();
  const [state, setState] = useState<UploadState>("idle");
  const [attachmentId, setAttachmentId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const statusQuery = trpc.attachments.getStatus.useQuery(
    { id: attachmentId! },
    {
      enabled: state === "polling" && attachmentId !== null,
      refetchInterval: POLL_INTERVAL_MS,
      refetchIntervalInBackground: false,
    },
  );

  // React to status changes
  const currentStatus = statusQuery.data?.extractionStatus;
  if (state === "polling") {
    if (currentStatus === "DONE") {
      setState("done");
      if (pollRef.current) clearInterval(pollRef.current);
    } else if (currentStatus === "FAILED") {
      setState("failed");
      if (pollRef.current) clearInterval(pollRef.current);
    }
  }

  function handleFileSelect(file: File) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast({
        variant: "destructive",
        title: "Unsupported file type",
        description: "Please upload a JPEG, PNG, WebP, or PDF file.",
      });
      return;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: "File too large",
        description: `Maximum file size is ${MAX_SIZE_MB} MB.`,
      });
      return;
    }
    setSelectedFile(file);
    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
    };

  async function handleUpload() {
    if (!selectedFile) return;
    setState("uploading");

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const res = await fetch("/api/attachments/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { attachmentId: string; status: string };
      setAttachmentId(data.attachmentId);
      setState("polling");
    } catch (err: unknown) {
      setState("idle");
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  function handleReset() {
    setState("idle");
    setAttachmentId(null);
    setSelectedFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const isProcessing = state === "uploading" || state === "polling";

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          AI Document Extraction
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Upload an invoice or receipt and let AI extract the data for you.
        </p>
      </div>

      {(state === "idle" || state === "uploading") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upload Document</CardTitle>
            <CardDescription>JPEG, PNG, WebP, or PDF — max {MAX_SIZE_MB} MB</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => !selectedFile && fileInputRef.current?.click()}
              className={cn(
                "relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 transition-colors cursor-pointer",
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/20 hover:border-primary/40 hover:bg-muted/30",
                selectedFile && "cursor-default",
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_TYPES.join(",")}
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelect(file);
                }}
              />

              {previewUrl ? (
                // Image preview
                <div className="space-y-2 text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="max-h-48 max-w-full rounded-lg object-contain mx-auto shadow"
                  />
                  <p className="text-sm font-medium">{selectedFile!.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(selectedFile!.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              ) : selectedFile ? (
                // PDF selected
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                    <FileText className="h-7 w-7 text-primary" />
                  </div>
                  <p className="text-sm font-medium">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(selectedFile.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              ) : (
                // Empty state
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                    <Upload className="h-7 w-7 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Drag & drop or click to browse</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Supports invoices, bills, and receipts
                    </p>
                  </div>
                  <div className="flex gap-2 mt-1">
                    <Badge variant="secondary" className="text-[10px]">
                       <ImageIcon className="h-2.5 w-2.5 mr-1" />JPEG
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">PNG</Badge>
                    <Badge variant="secondary" className="text-[10px]">WebP</Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      <FileText className="h-2.5 w-2.5 mr-1" />PDF
                    </Badge>
                  </div>
                </div>
              )}
            </div>

            {selectedFile && (
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={handleUpload}
                  disabled={isProcessing}
                >
                  {state === "uploading" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Uploading…
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Upload &amp; Extract
                    </>
                  )}
                </Button>
                <Button variant="outline" onClick={handleReset} disabled={isProcessing}>
                  Clear
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {state === "polling" && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <div className="relative">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Sparkles className="h-8 w-8 text-primary" />
              </div>
              <Loader2 className="absolute -top-1 -right-1 h-6 w-6 animate-spin text-primary" />
            </div>
            <div className="text-center space-y-1">
              <p className="font-semibold">Extracting document data…</p>
              <p className="text-sm text-muted-foreground">
                AI is reading your document. This usually takes a few seconds.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {state === "failed" && (
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col items-center gap-4 py-10">
            <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center">
              <XCircle className="h-8 w-8 text-destructive" />
            </div>
            <div className="text-center space-y-1">
              <p className="font-semibold">Extraction failed</p>
              <p className="text-sm text-muted-foreground">
                We couldn&apos;t extract data from this document. Try a clearer image or a different file.
              </p>
            </div>
            <Button variant="outline" onClick={handleReset}>
              Try another file
            </Button>
          </CardContent>
        </Card>
      )}

      {state === "done" &&
        attachmentId &&
        statusQuery.data?.extractionResult &&
        statusQuery.data.extractionStatus === "DONE" && (
          <div className="space-y-4">
            <Card className="border-green-500/30 bg-green-50/30 dark:bg-green-950/20">
              <CardContent className="flex items-center gap-3 py-3">
                <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Extraction successful</p>
                  <p className="text-xs text-muted-foreground">
                    {statusQuery.data.originalFilename} — review the data below and create a document
                  </p>
                </div>
                <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={handleReset}>
                  New upload
                </Button>
              </CardContent>
            </Card>
            <ExtractionSummary
              result={statusQuery.data.extractionResult as unknown as ExtractionResult}
              attachmentId={attachmentId}
            />
          </div>
        )}
    </div>
  );
}
