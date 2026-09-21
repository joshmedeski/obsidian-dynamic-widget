import type { Candidate, Decision, Strategy, Subject } from "./types";

export interface EngineOptions {
  threshold?: number;
  topK?: number;
}

export const DEFAULT_THRESHOLD = 0.15;
export const DEFAULT_TOP_K = 3;

export function decide(
  strategy: Strategy,
  subject: Subject,
  candidates: readonly Candidate[],
  options: EngineOptions = {},
): Decision {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const topK = options.topK ?? DEFAULT_TOP_K;

  const ranked = [...strategy.rank(subject, candidates)].sort(
    (a, b) => b.score - a.score,
  );
  const choices = ranked.filter((c) => c.score >= threshold).slice(0, topK);

  return {
    subjectId: subject.id,
    choices,
    abstained: choices.length === 0,
    strategy: strategy.name,
  };
}

export function ancestors(
  areaId: string,
  candidates: readonly Candidate[],
): string[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const seen: string[] = [];
  const queue = [...(byId.get(areaId)?.parents ?? [])];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (seen.includes(current)) continue;
    const candidate = byId.get(current);
    if (!candidate) continue;
    seen.push(current);
    queue.push(...candidate.parents);
  }
  return seen;
}
