"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Signal } from "@/server/services/outreach/types";
import { AiNotice, useAiReady } from "../../_components/ai-notice";
import { clampExtracted } from "../../_components/extract-limits";
import { ENRICHMENT_LABEL } from "../../_components/labels";
import { OutreachGate } from "../../_components/outreach-gate";
import { SignalsEditor } from "../../_components/signals-editor";
import { Textarea } from "../../_components/textarea";

type Status = "checked" | "unreachable" | "no_website" | "refused";
type Form = {
  name: string;
  title: string;
  company: string;
  companyWebsite: string;
  companySize: string;
  location: string;
  stack: string;
  signals: Signal[];
  enrichmentStatus: Status | null;
};
const EMPTY: Form = {
  name: "",
  title: "",
  company: "",
  companyWebsite: "",
  companySize: "",
  location: "",
  stack: "",
  signals: [],
  enrichmentStatus: null,
};

/** Keep the first signal of each name (extraction first, then the website check). */
function mergeSignals(...lists: Signal[][]): Signal[] {
  const seen = new Set<string>();
  return lists.flat().filter((s) => (seen.has(s.name) ? false : (seen.add(s.name), true)));
}

export default function NewProspectPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Add prospect"
        description="Paste a Sales Navigator profile. Nothing is saved until you press Save."
      />
      <OutreachGate>
        <NewProspectForm />
      </OutreachGate>
    </div>
  );
}

function NewProspectForm() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [website, setWebsite] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const aiReady = useAiReady();
  const extract = trpc.outreachProspects.extract.useMutation({
    onSuccess: ({ profileUrl, extracted, enrichment }) => {
      setUrl(profileUrl);
      const c = clampExtracted(extracted);
      setForm({
        name: c.name,
        title: c.title,
        company: c.company,
        // Only the website the server checked: a model guess the paste never named is dropped.
        companyWebsite: enrichment.website ?? "",
        companySize: c.companySize,
        location: c.location,
        stack: c.stack.join(", "),
        signals: mergeSignals(c.signals, enrichment.signals),
        enrichmentStatus: enrichment.status,
      });
    },
    onError: (e) => toast.error(e.message),
  });
  const create = trpc.outreachProspects.create.useMutation({
    onSuccess: ({ id, created }) => {
      void utils.outreachProspects.list.invalidate();
      void utils.outreachToday.get.invalidate();
      if (!created) toast.info("Already saved. Updated their details and opened their page.");
      router.push(`/outreach/prospects/${id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  function save() {
    if (!form) return;
    const companyWebsite = form.companyWebsite.trim();
    create.mutate({
      profileUrl: url,
      name: form.name,
      title: form.title,
      company: form.company,
      companyWebsite: companyWebsite || null,
      companySize: form.companySize || null,
      location: form.location || null,
      profileText: text,
      stack: form.stack
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      signals: form.signals,
      // Filling in by hand doesn't check the website; see the ruling in Task 16.
      enrichmentStatus: form.enrichmentStatus ?? (companyWebsite ? "unreachable" : "no_website"),
    });
  }

  const field = (key: keyof Omit<Form, "signals" | "enrichmentStatus">, label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={key}>{label}</Label>
      <Input
        id={key}
        value={form?.[key] ?? ""}
        onChange={(e) => setForm((f) => f && { ...f, [key]: e.target.value })}
      />
    </div>
  );
  // The server rejects a signal without evidence, so block Save rather than drop the row silently.
  const blankEvidence = !!form?.signals.some((s) => !s.evidence.trim());

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Paste the profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <AiNotice />
          <div className="space-y-1.5">
            <Label htmlFor="url">LinkedIn or Sales Navigator profile URL</Label>
            <Input
              id="url"
              value={url}
              placeholder="https://www.linkedin.com/in/…"
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="text">Profile text (About, Experience, Activity)</Label>
            <Textarea
              id="text"
              className="min-h-[260px]"
              maxLength={50_000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <p className="text-muted-foreground text-xs tabular-nums">
              {text.length.toLocaleString()} / 50,000
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="website">
              Company website (optional, overrides the one on the profile)
            </Label>
            <Input
              id="website"
              value={website}
              placeholder="acme.ai"
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>
          {extract.error && <p className="text-destructive text-sm">{extract.error.message}</p>}
          <div className="flex gap-2">
            <Button
              disabled={!aiReady || extract.isPending || !url.trim() || !text.trim()}
              onClick={() =>
                extract.mutate({
                  profileUrl: url,
                  profileText: text,
                  companyWebsite: website || null,
                })
              }
            >
              {extract.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-1 h-4 w-4" />
              )}
              {extract.isPending ? "Reading…" : "Extract"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setForm((f) => f ?? { ...EMPTY, companyWebsite: website })}
            >
              Fill in by hand
            </Button>
          </div>
        </CardContent>
      </Card>

      {form && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Check and save</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {field("name", "Name")}
              {field("title", "Title")}
              {field("company", "Company")}
              {field("companyWebsite", "Company website")}
              {field("companySize", "Company size")}
              {field("location", "Location")}
            </div>
            {field("stack", "Stack (comma separated)")}
            <div className="space-y-1.5">
              <Label>Signals</Label>
              <SignalsEditor
                value={form.signals}
                onChange={(signals) => setForm((f) => f && { ...f, signals })}
              />
            </div>
            {form.enrichmentStatus && (
              <p className="text-muted-foreground text-xs">
                {ENRICHMENT_LABEL[form.enrichmentStatus]}
              </p>
            )}
            {blankEvidence && (
              <p className="text-muted-foreground text-sm">
                Add evidence to each signal, or remove it.
              </p>
            )}
            {create.error && <p className="text-destructive text-sm">{create.error.message}</p>}
            <Button
              disabled={
                create.isPending ||
                create.isSuccess ||
                !form.name.trim() ||
                !url.trim() ||
                blankEvidence
              }
              onClick={save}
            >
              {(create.isPending || create.isSuccess) && (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              )}
              Save prospect
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
