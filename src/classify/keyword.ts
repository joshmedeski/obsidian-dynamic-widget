import type { Candidate, Choice, Strategy, Subject } from "./types";

const WORD = /[a-z0-9][a-z0-9'\-.]*/g;

const STOPWORDS = new Set(
  `a an and are as at be been but by for from how i in is it its me my of on
  or that the their them they this to up use used using was what when where
  which who will with without you your own out into over about also than
  then some any all more most other`.split(/\s+/),
);

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(WORD) ?? [];
}

export function contentWords(text: string): string[] {
  return tokenize(text).filter((t) => !STOPWORDS.has(t) && t.length > 2);
}

export interface KeywordOptions {
  summaryWeight?: number;
  titleBoost?: number;
  positionDecay?: number;
  tfExponent?: number;
}

interface Index {
  nameDf: Map<string, number>;
  summaryDf: Map<string, number>;
  entries: { candidate: Candidate; names: string[]; terms: string[] }[];
}

export class KeywordStrategy implements Strategy {
  readonly name = "keyword";

  private readonly summaryWeight: number;
  private readonly titleBoost: number;
  private readonly positionDecay: number;
  private readonly tfExponent: number;
  private readonly indexes = new WeakMap<object, Index>();

  constructor(options: KeywordOptions = {}) {
    this.summaryWeight = options.summaryWeight ?? 0.35;
    this.titleBoost = options.titleBoost ?? 3.0;
    this.positionDecay = options.positionDecay ?? 0.75;
    this.tfExponent = options.tfExponent ?? 0.5;
  }

  rank(subject: Subject, candidates: readonly Candidate[]): Choice[] {
    const counts = new Map<string, number>();
    let total = 0;
    for (const token of tokenize(subject.text)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
      total += 1;
    }
    if (counts.size === 0) return [];

    const lowered = subject.text.toLowerCase();
    const title = tokenize(subject.title);
    const index = this.indexFor(candidates);
    const n = candidates.length;

    const choices: Choice[] = [];
    for (const { candidate, names, terms } of index.entries) {
      let score = 0;
      const matched: string[] = [];
      for (const phrase of names) {
        const hits = phraseHits(phrase, counts, lowered);
        if (hits === 0) continue;
        const position = titlePosition(phrase, title);
        const weight = idf(n, index.nameDf.get(phrase.toLowerCase()) ?? 0);
        score += this.tf(hits) * weight * this.boost(position);
        matched.push(position === null ? phrase : `${phrase}@t${position}`);
      }

      let support = 0;
      const evidence: string[] = [];
      for (const term of terms) {
        const hits = counts.get(term) ?? 0;
        if (hits === 0) continue;
        support += this.tf(hits) * idf(n, index.summaryDf.get(term) ?? 0);
        evidence.push(term);
      }
      score += this.summaryWeight * support;

      if (score !== 0) {
        choices.push({
          candidateId: candidate.id,
          score: score / Math.sqrt(total),
          rationale: rationale(matched, evidence),
        });
      }
    }
    return choices;
  }

  private indexFor(candidates: readonly Candidate[]): Index {
    const cached = this.indexes.get(candidates as object);
    if (cached) return cached;

    const nameDf = new Map<string, number>();
    const summaryDf = new Map<string, number>();
    const entries = candidates.map((candidate) => {
      const names = [candidate.label, ...candidate.aliases];
      for (const term of new Set(names.map((p) => p.toLowerCase()))) {
        nameDf.set(term, (nameDf.get(term) ?? 0) + 1);
      }
      const terms = [...new Set(contentWords(candidate.summary))];
      for (const term of terms) {
        summaryDf.set(term, (summaryDf.get(term) ?? 0) + 1);
      }
      return { candidate, names, terms };
    });

    const index = { nameDf, summaryDf, entries };
    this.indexes.set(candidates as object, index);
    return index;
  }

  private tf(hits: number): number {
    return Math.pow(hits, this.tfExponent);
  }

  private boost(position: number | null): number {
    if (position === null) return 1;
    return 1 + this.titleBoost * Math.exp(-position / this.positionDecay);
  }
}

function idf(n: number, df: number): number {
  return Math.log(1 + n / (1 + df));
}

function phraseHits(
  phrase: string,
  counts: Map<string, number>,
  lowered: string,
): number {
  const parts = tokenize(phrase);
  if (parts.length === 0) return 0;
  if (parts.length === 1) return counts.get(parts[0]) ?? 0;
  return lowered.split(parts.join(" ")).length - 1;
}

function titlePosition(phrase: string, title: string[]): number | null {
  const parts = tokenize(phrase);
  if (parts.length === 0) return null;
  for (let i = 0; i <= title.length - parts.length; i += 1) {
    if (parts.every((part, offset) => title[i + offset] === part)) return i;
  }
  return null;
}

function rationale(matched: string[], evidence: string[]): string {
  const bits: string[] = [];
  if (matched.length > 0) {
    bits.push(`name ${unique(matched).slice(0, 4).join(", ")}`);
  }
  if (evidence.length > 0) {
    bits.push(`summary ${unique(evidence).slice(0, 5).join(", ")}`);
  }
  return bits.join(" | ");
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
