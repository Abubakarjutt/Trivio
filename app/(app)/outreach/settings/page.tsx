"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/app/(app)/_components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SIGNAL_NAMES, type Cadence, type Weights } from "@/server/services/outreach/types";
import { AiNotice } from "../_components/ai-notice";
import { SIGNAL_LABEL } from "../_components/labels";
import { OfferEditor } from "../_components/offer-editor";
import { OutreachGate } from "../_components/outreach-gate";
import { Textarea } from "../_components/textarea";

type TabId = "profile" | "weights" | "limits";
type CadenceKey = keyof Cadence;

// Labels describe what each value delays in nextAction (server/services/outreach/pipeline.ts).
const CADENCE_LABEL: Record<CadenceKey, string> = {
  withdrawAfter: "Withdraw an unanswered request after",
  lightTouch: "Light touch after your last message",
  secondValue: "Second value message or follow-up after your last message",
  nurtureAfterSecond: "Move to nurture after your second unanswered message",
  nurtureEvery: "Nurture touch every",
  teardownFollowUp: "Follow up after a teardown",
};
const CADENCE_KEYS = Object.keys(CADENCE_LABEL) as CadenceKey[];

const MAX_PROFILE = 50_000;

// Number fields are edited as text so a half-typed value never becomes NaN.
type Fields<K extends string> = Record<K, string>;
type WeightsForm = { weights: Fields<keyof Weights>; keywords: string };
type LimitsForm = { dailyCap: string; weeklyCap: string; cadence: Fields<CadenceKey> };

function intIn(v: string, min: number, max: number, what: string): string | null {
  if (!/^\d+$/.test(v.trim())) return `${what}: enter a whole number.`;
  const n = Number(v);
  return n < min || n > max ? `${what}: enter ${min} to ${max}.` : null;
}
const toInt = (v: string) => Number(v.trim());
const parseKeywords = (s: string) =>
  s
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

function validateProfile(profile: string): string | null {
  if (!profile.trim()) return "Describe what you sell before saving.";
  if (profile.length > MAX_PROFILE)
    return `Keep it under ${MAX_PROFILE.toLocaleString()} characters.`;
  return null;
}
function validateWeights(f: WeightsForm): { weights: string | null; keywords: string | null } {
  const bad = SIGNAL_NAMES.map((s) => intIn(f.weights[s], 0, 10, SIGNAL_LABEL[s])).find(Boolean);
  const kws = parseKeywords(f.keywords);
  const keywords =
    kws.length > 30
      ? "Use at most 30 keywords."
      : kws.some((k) => k.length > 60)
        ? "Each keyword can be up to 60 characters."
        : null;
  return { weights: bad ?? null, keywords };
}
function validateLimits(f: LimitsForm): { caps: string | null; cadence: string | null } {
  const caps =
    intIn(f.dailyCap, 1, 200, "Daily limit") ?? intIn(f.weeklyCap, 1, 1000, "Weekly limit");
  const cadence = CADENCE_KEYS.map((k) => intIn(f.cadence[k], 1, 365, CADENCE_LABEL[k])).find(
    Boolean
  );
  return { caps, cadence: cadence ?? null };
}

/**
 * Local copy of one tab's server values. It follows the server when the server value changes,
 * unless the person has unsaved edits in that tab (then their edits stay).
 */
function useSyncedForm<T>(server: T | undefined): [T | undefined, (v: T) => void, boolean] {
  const [local, setLocal] = useState<T | undefined>(server);
  const base = useRef<string | undefined>(
    server === undefined ? undefined : JSON.stringify(server)
  );
  const key = server === undefined ? undefined : JSON.stringify(server);
  useEffect(() => {
    if (server === undefined || key === base.current) return;
    const dirty = JSON.stringify(local) !== base.current;
    base.current = key;
    if (!dirty) setLocal(server);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the server value changing
  }, [key]);
  const value = local ?? server;
  return [value, setLocal, value !== undefined && JSON.stringify(value) !== base.current];
}

export default function OutreachSettingsPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Outreach settings"
        description="What you sell, your offers, scoring and daily limits."
      />
      <OutreachGate>
        <SettingsTabs />
      </OutreachGate>
    </div>
  );
}

function SettingsTabs() {
  const utils = trpc.useUtils();
  const { data, isError, error, refetch } = trpc.outreachSettings.get.useQuery();
  const settings = data?.settings ?? undefined;
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [saveError, setSaveError] = useState<{ tab: TabId; message: string } | null>(null);

  const [profile, setProfile, profileDirty] = useSyncedForm<string>(settings?.sellerProfile);
  const [weightsForm, setWeightsForm, weightsDirty] = useSyncedForm<WeightsForm>(
    settings && {
      weights: Object.fromEntries(
        SIGNAL_NAMES.map((s) => [s, String(settings.weights[s])])
      ) as Fields<keyof Weights>,
      keywords: settings.hiringKeywords.join(", "),
    }
  );
  const [limitsForm, setLimitsForm, limitsDirty] = useSyncedForm<LimitsForm>(
    settings && {
      dailyCap: String(settings.dailyCap),
      weeklyCap: String(settings.weeklyCap),
      cadence: Object.fromEntries(
        CADENCE_KEYS.map((k) => [k, String(settings.cadence[k])])
      ) as Fields<CadenceKey>,
    }
  );
  const [touched, setTouched] = useState<Record<TabId, boolean>>({
    profile: false,
    weights: false,
    limits: false,
  });

  const upsert = trpc.outreachSettings.upsert.useMutation({
    // Returned so the mutation stays pending until the cache is fresh: the next save reads it.
    onSuccess: async () => {
      await Promise.all([
        utils.outreachSettings.get.invalidate(),
        utils.outreachToday.get.invalidate(),
      ]);
    },
  });
  const rescore = trpc.outreachProspects.rescoreAll.useMutation({
    onSuccess: ({ total, changed }) => {
      void utils.outreachProspects.list.invalidate();
      void utils.outreachProspects.get.invalidate();
      void utils.outreachToday.get.invalidate();
      toast.success(
        total === 0
          ? "No prospects to rescore yet."
          : `Rescored ${total} prospect${total === 1 ? "" : "s"}: ${changed} changed.`
      );
    },
    onError: (e) => toast.error(e.message),
  });
  const archive = trpc.outreachSettings.offerArchive.useMutation({
    onSuccess: () => utils.outreachSettings.get.invalidate(),
    // The offer may have changed elsewhere: refresh so the list is truthful.
    onError: () => void utils.outreachSettings.get.invalidate(),
  });

  if (!data || !settings || profile === undefined || !weightsForm || !limitsForm) {
    return isError ? (
      <div className="border-border/60 max-w-3xl space-y-3 rounded-xl border p-4">
        <p className="text-destructive text-sm">
          Couldn&apos;t load your Outreach settings: {error?.message}
        </p>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    ) : (
      <div className="bg-muted h-64 animate-pulse rounded-xl" />
    );
  }

  /** One upsert of the whole object: the latest server settings plus only this tab's fields. */
  function save(tab: TabId, label: string, edited: Partial<Record<string, unknown>>) {
    const latest = utils.outreachSettings.get.getData()?.settings ?? settings;
    if (!latest) return;
    setSaveError(null);
    upsert.mutate(
      {
        sellerProfile: latest.sellerProfile,
        signalWeights: latest.weights,
        cadence: latest.cadence,
        dailyCap: latest.dailyCap,
        weeklyCap: latest.weeklyCap,
        hiringKeywords: latest.hiringKeywords,
        ...edited,
      },
      {
        onSuccess: () => toast.success(`${label} saved`),
        onError: (e) => setSaveError({ tab, message: e.message }),
      }
    );
  }

  const saveRow = (tab: TabId, dirty: boolean, onSave: () => void) => (
    <div className="flex items-center gap-3">
      <Button size="sm" disabled={upsert.isPending} onClick={onSave}>
        {upsert.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
        Save
      </Button>
      {dirty && !upsert.isPending && (
        <span className="text-muted-foreground text-xs">Unsaved changes</span>
      )}
      {saveError?.tab === tab && <p className="text-destructive text-sm">{saveError.message}</p>}
    </div>
  );
  const err = (tab: TabId, msg: string | null | undefined) =>
    touched[tab] && msg ? <p className="text-destructive text-sm">{msg}</p> : null;

  const profileError = validateProfile(profile);
  const weightsErrors = validateWeights(weightsForm);
  const limitsErrors = validateLimits(limitsForm);

  const trySave = (tab: TabId, label: string, errors: (string | null)[], build: () => object) => {
    setTouched((t) => ({ ...t, [tab]: true }));
    if (errors.some(Boolean)) return;
    save(tab, label, build());
  };

  return (
    <Tabs defaultValue="profile" className="max-w-3xl">
      <TabsList>
        <TabsTrigger value="profile">Seller profile</TabsTrigger>
        <TabsTrigger value="offers">Offers</TabsTrigger>
        <TabsTrigger value="weights">Signal weights</TabsTrigger>
        <TabsTrigger value="limits">Limits and timing</TabsTrigger>
      </TabsList>

      <TabsContent value="profile">
        <Card>
          <CardContent className="space-y-4 p-5">
            <AiNotice />
            <Textarea
              className="min-h-[360px] font-mono text-xs"
              maxLength={MAX_PROFILE}
              aria-label="Seller profile"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
            />
            {err("profile", profileError)}
            {saveRow("profile", profileDirty, () =>
              trySave("profile", "Seller profile", [profileError], () => ({
                sellerProfile: profile,
              }))
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="offers">
        <Card>
          <CardContent className="space-y-3 p-5">
            {archive.error && (
              <p className="text-destructive text-sm">
                Couldn&apos;t update the offer: {archive.error.message}
              </p>
            )}
            {data.offers.map((o) =>
              editing === o.id ? (
                <OfferEditor key={o.id} offer={o} onDone={() => setEditing(null)} />
              ) : (
                <div
                  key={o.id}
                  className={`border-border/60 flex items-start gap-3 rounded-lg border p-4 ${o.archived ? "opacity-60" : ""}`}
                >
                  <div className="flex-1">
                    <p className="font-medium">
                      {o.name}
                      {o.archived && " (archived)"}
                    </p>
                    <p className="text-muted-foreground text-sm">{o.description}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {o.price ? `Price ${o.price}` : "No price yet: proposals show [price]"}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(o.id)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={archive.isPending}
                    onClick={() => archive.mutate({ id: o.id, archived: !o.archived })}
                  >
                    {o.archived ? "Restore" : "Archive"}
                  </Button>
                </div>
              )
            )}
            {editing === "new" ? (
              <OfferEditor onDone={() => setEditing(null)} />
            ) : (
              <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
                Add offer
              </Button>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="weights">
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              {SIGNAL_NAMES.map((s) => (
                <div key={s} className="flex items-center justify-between gap-3">
                  <Label htmlFor={`w-${s}`}>{SIGNAL_LABEL[s]}</Label>
                  <Input
                    id={`w-${s}`}
                    type="number"
                    min={0}
                    max={10}
                    className="w-20"
                    value={weightsForm.weights[s]}
                    onChange={(e) =>
                      setWeightsForm({
                        ...weightsForm,
                        weights: { ...weightsForm.weights, [s]: e.target.value },
                      })
                    }
                  />
                </div>
              ))}
            </div>
            {err("weights", weightsErrors.weights)}
            <div className="space-y-1.5">
              <Label htmlFor="keywords">Hiring keywords (comma separated)</Label>
              <Input
                id="keywords"
                value={weightsForm.keywords}
                onChange={(e) => setWeightsForm({ ...weightsForm, keywords: e.target.value })}
              />
              <p className="text-muted-foreground text-xs">
                A careers page mentioning one of these next to engineer, developer or scientist
                counts as hiring.
              </p>
              {err("weights", weightsErrors.keywords)}
            </div>
            {saveRow("weights", weightsDirty, () =>
              trySave(
                "weights",
                "Signal weights",
                [weightsErrors.weights, weightsErrors.keywords],
                () => ({
                  signalWeights: Object.fromEntries(
                    SIGNAL_NAMES.map((s) => [s, toInt(weightsForm.weights[s])])
                  ),
                  hiringKeywords: parseKeywords(weightsForm.keywords),
                })
              )
            )}
            <div className="border-border/60 flex flex-wrap items-center gap-3 border-t pt-4">
              <Button
                size="sm"
                variant="outline"
                disabled={weightsDirty || upsert.isPending || rescore.isPending}
                onClick={() => rescore.mutate()}
              >
                {rescore.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Rescore all prospects
              </Button>
              <p className="text-muted-foreground text-xs">
                {weightsDirty
                  ? "Save your weights first, then rescore."
                  : "Saved weights apply to new and edited prospects. Rescore to apply them to everyone already saved."}
              </p>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="limits">
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="daily">Connection requests per day</Label>
                <Input
                  id="daily"
                  type="number"
                  min={1}
                  max={200}
                  value={limitsForm.dailyCap}
                  onChange={(e) => setLimitsForm({ ...limitsForm, dailyCap: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="weekly">Connection requests per week</Label>
                <Input
                  id="weekly"
                  type="number"
                  min={1}
                  max={1000}
                  value={limitsForm.weeklyCap}
                  onChange={(e) => setLimitsForm({ ...limitsForm, weeklyCap: e.target.value })}
                />
              </div>
            </div>
            {err("limits", limitsErrors.caps)}
            <div className="space-y-2">
              {CADENCE_KEYS.map((k) => (
                <div key={k} className="flex items-center justify-between gap-3">
                  <Label htmlFor={`c-${k}`} className="font-normal">
                    {CADENCE_LABEL[k]}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`c-${k}`}
                      type="number"
                      min={1}
                      max={365}
                      className="w-20"
                      value={limitsForm.cadence[k]}
                      onChange={(e) =>
                        setLimitsForm({
                          ...limitsForm,
                          cadence: { ...limitsForm.cadence, [k]: e.target.value },
                        })
                      }
                    />
                    <span className="text-muted-foreground text-sm">days</span>
                  </div>
                </div>
              ))}
            </div>
            {err("limits", limitsErrors.cadence)}
            {saveRow("limits", limitsDirty, () =>
              trySave(
                "limits",
                "Limits and timing",
                [limitsErrors.caps, limitsErrors.cadence],
                () => ({
                  dailyCap: toInt(limitsForm.dailyCap),
                  weeklyCap: toInt(limitsForm.weeklyCap),
                  cadence: Object.fromEntries(
                    CADENCE_KEYS.map((k) => [k, toInt(limitsForm.cadence[k])])
                  ),
                })
              )
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
