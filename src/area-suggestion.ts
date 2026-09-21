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

const ENGINE_PROJECT = join(homedir(), "c", "decision-engine");
const TIMEOUT_MS = 20000;

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
  const adapter = app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) {
    throw new Error("Area suggestions need a local vault");
  }
  const vaultPath = adapter.getBasePath();

  const stdout = await run(resolveUv(), [
    "run",
    "--project",
    ENGINE_PROJECT,
    "classify-note",
    join(vaultPath, file.path),
    "--json",
    "--vault",
    vaultPath,
  ]);

  const parsed = JSON.parse(stdout) as AreaSuggestion;
  if (!Array.isArray(parsed.choices)) {
    throw new Error("Classifier returned an unexpected payload");
  }
  return parsed;
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: TIMEOUT_MS, encoding: "utf8" },
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
