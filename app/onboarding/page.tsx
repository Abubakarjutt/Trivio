"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useToast } from "@/lib/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Building2, Globe, Check } from "lucide-react";

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

export default function OnboardingPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>(1);

  const [step1Data, setStep1Data] = useState({ businessName: "", businessType: "SOLE_TRADER" });
  const [step2Data, setStep2Data] = useState({ currency: "USD", taxRegimeId: "", fiscalYearStartMonth: "1" });

  const { data: currencies } = trpc.org.getCurrencies.useQuery();
  const { data: taxRegimes } = trpc.org.getTaxRegimes.useQuery();

  const setupStep1 = trpc.org.setupStep1.useMutation({
    onSuccess: () => setStep(2),
    onError: (err) => toast({ variant: "destructive", title: err.message }),
  });

  const setupStep2 = trpc.org.setupStep2.useMutation({
    onSuccess: () => {
      setStep(3);
      setTimeout(() => router.push("/dashboard"), 1500);
    },
    onError: (err) => toast({ variant: "destructive", title: err.message }),
  });

  const progress = step === 1 ? 33 : step === 2 ? 66 : 100;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground font-bold text-lg">A</div>
          <h1 className="text-2xl font-bold">Set up AutoAccounts</h1>
          <p className="text-muted-foreground text-sm">Step {step} of 2 — takes about 2 minutes</p>
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
                {setupStep1.isPending && <Loader2 className="animate-spin" />}
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
                  {setupStep2.isPending && <Loader2 className="animate-spin" />}
                  Finish setup
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Complete */}
        {step === 3 && (
          <Card>
            <CardContent className="py-12 text-center space-y-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                <Check className="h-8 w-8 text-green-600" />
              </div>
              <h2 className="text-xl font-semibold">You&apos;re all set!</h2>
              <p className="text-muted-foreground text-sm">
                Your chart of accounts has been created. Redirecting to your dashboard...
              </p>
              <Loader2 className="mx-auto animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
