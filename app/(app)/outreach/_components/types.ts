import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/root";

export type Outputs = inferRouterOutputs<AppRouter>;
export type TodayData = Extract<Outputs["outreachToday"]["get"], { configured: true }>;
export type TodayItem = TodayData["buckets"][number]["items"][number];
export type ProspectDetail = Outputs["outreachProspects"]["get"];
export type DraftRow = { variant: string; body: string; violations: string[] };
