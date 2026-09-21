import type { App, TFile } from "obsidian";
import { ancestors, decide } from "./classify/engine";
import { KeywordStrategy } from "./classify/keyword";
import type { Candidate, Decision } from "./classify/types";

export interface AreaChoice {
  area: string;
  score: number;
  rationale: string;
  lineage: string[];
}

export interface AreaSuggestion {
  note: string;
  title: string;
  strategy: string;
  abstained: boolean;
  areas: string[];
  existing_areas: string[];
  choices: AreaChoice[];
}

/**
 * Score bands measured against the classifier's own gold set
 * (`evals/calibrate.py` in the decision-engine repo, 665 predicted choices).
 * Share of predictions whose area was literally in the note's own `areas:`
 *
 *   0.15-0.75   62% of choices   19% correct
 *   0.75-1.50   25% of choices   37% correct
 *   1.50+       13% of choices   53% correct
 *
 * The engine abstains below 0.15, so that is the floor rather than zero.
 */
const CONFIDENCE_HIGH = 1.5;
const CONFIDENCE_MEDIUM = 0.75;

export type Confidence = "low" | "medium" | "high";

export function confidenceOf(score: number): Confidence {
  if (score >= CONFIDENCE_HIGH) return "high";
  if (score >= CONFIDENCE_MEDIUM) return "medium";
  return "low";
}

const AREAS_FOLDER = "Areas";
const FALLBACK_AREA = "Inbox";
const SKIP_DIRS = new Set([
  AREAS_FOLDER,
  "Assets",
  "Days",
  ".git",
  ".trash",
  ".claude",
  ".obsidian",
]);
const WIKILINK = /^\[\[([^\]|#]+)/;

const strategy = new KeywordStrategy();

export function hasAreas(app: App, file: TFile): boolean {
  const areas = app.metadataCache.getFileCache(file)?.frontmatter?.areas;
  if (!areas) return false;
  return !Array.isArray(areas) || areas.length > 0;
}

export async function suggestAreas(
  app: App,
  file: TFile,
): Promise<AreaSuggestion> {
  return classify(app, file, loadAreas(app));
}

export async function classifyVault(app: App): Promise<AreaSuggestion[]> {
  const candidates = loadAreas(app);
  const results: AreaSuggestion[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    if (!isClassifiable(file)) continue;
    results.push(await classify(app, file, candidates));
  }
  return results;
}

function isClassifiable(file: TFile): boolean {
  const parts = file.path.split("/");
  if (parts.some((part) => part.startsWith("."))) return false;
  return !parts.slice(0, -1).some((part) => SKIP_DIRS.has(part));
}

async function classify(
  app: App,
  file: TFile,
  candidates: Candidate[],
): Promise<AreaSuggestion> {
  const title = file.basename;
  const body = stripFrontmatter(await app.vault.cachedRead(file));
  const decision = decide(
    strategy,
    { id: title, text: `${title}\n${body}`, title },
    candidates,
  );
  return {
    note: file.path,
    title,
    strategy: decision.strategy,
    abstained: decision.abstained,
    areas: render(decision),
    existing_areas: frontmatterAreas(app, file),
    choices: decision.choices.map((choice) => ({
      area: choice.candidateId,
      score: round(choice.score),
      rationale: choice.rationale,
      lineage: ancestors(choice.candidateId, candidates),
    })),
  };
}

function render(decision: Decision): string[] {
  if (decision.abstained) return [`[[${FALLBACK_AREA}]]`];
  return decision.choices.map((choice) => `[[${choice.candidateId}]]`);
}

export function loadAreas(app: App): Candidate[] {
  return app.vault
    .getMarkdownFiles()
    .filter((file) => file.parent?.path === AREAS_FOLDER)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((file) => {
      const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
      return {
        id: file.basename,
        label: file.basename,
        aliases: asList(frontmatter?.aliases),
        summary: asList(frontmatter?.summary)[0] ?? "",
        parents: wikilinks(asList(frontmatter?.areas)),
      };
    });
}

function frontmatterAreas(app: App, file: TFile): string[] {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  return wikilinks(asList(frontmatter?.areas));
}

function wikilinks(values: string[]): string[] {
  const links: string[] = [];
  for (const value of values) {
    const match = WIKILINK.exec(value);
    if (match) links.push(match[1].trim());
  }
  return links;
}

function asList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  return typeof value === "string" ? [value] : [];
}

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---\n")) return raw;
  const end = raw.indexOf("\n---", 4);
  return end === -1 ? raw : raw.slice(end + 4);
}

function round(score: number): number {
  return Math.round(score * 10000) / 10000;
}
