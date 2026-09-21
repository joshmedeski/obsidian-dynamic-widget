import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { FileSystemAdapter, type App, type TFile } from "obsidian";

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

const ENGINE_PROJECT = join(homedir(), "c", "decision-engine");
const TIMEOUT_MS = 20000;
const VAULT_TIMEOUT_MS = 300000;
const VAULT_MAX_BUFFER = 64 * 1024 * 1024;

// Obsidian launched from Finder inherits a minimal PATH that misses Homebrew
// and the uv installer's own bin dir, so resolve the binary before spawning.
const UV_CANDIDATES = [
  "/opt/homebrew/bin/uv",
  "/usr/local/bin/uv",
  join(homedir(), ".local", "bin", "uv"),
  join(homedir(), ".cargo", "bin", "uv"),
];

function resolveUv(): string {
  return UV_CANDIDATES.find((path) => existsSync(path)) ?? "uv";
}

export function hasAreas(app: App, file: TFile): boolean {
  const areas = app.metadataCache.getFileCache(file)?.frontmatter?.areas;
  if (!areas) return false;
  return !Array.isArray(areas) || areas.length > 0;
}

export async function suggestAreas(
  app: App,
  file: TFile,
): Promise<AreaSuggestion> {
  const vaultPath = basePath(app);

  const stdout = await run(resolveUv(), classifyArgs(join(vaultPath, file.path), vaultPath));

  const parsed = JSON.parse(stdout) as AreaSuggestion;
  if (!Array.isArray(parsed.choices)) {
    throw new Error("Classifier returned an unexpected payload");
  }
  return parsed;
}

/**
 * Every note in the vault in one subprocess. The CLI emits one JSON object per
 * line when handed a directory, and the whole vault takes a couple of seconds
 * -- cheaper than 3000 spawns, so there is no per-note caching here.
 */
export async function classifyVault(app: App): Promise<AreaSuggestion[]> {
  const vaultPath = basePath(app);

  const stdout = await run(resolveUv(), classifyArgs(vaultPath, vaultPath), {
    timeout: VAULT_TIMEOUT_MS,
    maxBuffer: VAULT_MAX_BUFFER,
  });

  return stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as AreaSuggestion)
    .filter((entry) => Array.isArray(entry.choices));
}

function classifyArgs(target: string, vaultPath: string): string[] {
  return [
    "run",
    "--project",
    ENGINE_PROJECT,
    "classify-note",
    target,
    "--json",
    "--vault",
    vaultPath,
  ];
}

export function basePath(app: App): string {
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) {
    throw new Error("Area suggestions need a local vault");
  }
  return adapter.getBasePath();
}

function run(
  command: string,
  args: string[],
  options: { timeout?: number; maxBuffer?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: TIMEOUT_MS, encoding: "utf8", ...options },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.trim() || error.message;
          reject(new Error(`classify-note failed: ${detail}`));
          return;
        }
        if (!stdout.trim()) {
          reject(new Error("classify-note produced no output"));
          return;
        }
        resolve(stdout);
      },
    );
  });
}
