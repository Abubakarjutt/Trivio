// Port of linkedin-outreach/outreach/scoring.py.
import { SIGNAL_NAMES, type Signal, type SignalName, type Weights } from "./types";

export type ScoreResult = { score: number; primary: Signal | null; reasons: string[] };

export function scoreSignals(signals: Signal[], weights: Weights): ScoreResult {
  const unique = new Map<SignalName, Signal>();
  for (const s of signals) if (!unique.has(s.name)) unique.set(s.name, s);
  const order = SIGNAL_NAMES as readonly SignalName[];
  const ranked = [...unique.values()].sort(
    (a, b) => weights[b.name] - weights[a.name] || order.indexOf(a.name) - order.indexOf(b.name)
  );
  return {
    score: ranked.reduce((total, s) => total + weights[s.name], 0),
    primary: ranked[0] ?? null,
    reasons: ranked.map((s) => `${s.name} (+${weights[s.name]}): ${s.evidence}`),
  };
}
