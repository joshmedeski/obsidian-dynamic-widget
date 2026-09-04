import type { App, TFile } from "obsidian";
import { normalizeAreasFrontmatter, simplifyWikiLink } from "./utils";

export interface AreaNode {
  file: TFile;
  priority: number | null;
  children: AreaNode[];
}

export function getTopLevelAreas(app: App): TFile[] {
  const areaFiles = app.vault.getFiles().filter(
    (f) =>
      f.path.startsWith("Areas/") &&
      f.extension === "md" &&
      f.path.split("/").length === 2,
  );

  const topLevel = areaFiles.filter((f) => {
    const metadata = app.metadataCache.getFileCache(f);
    const areas = metadata?.frontmatter?.areas;
    return !areas || (Array.isArray(areas) && areas.length === 0);
  });

  topLevel.sort((a, b) => {
    const aMeta = app.metadataCache.getFileCache(a);
    const bMeta = app.metadataCache.getFileCache(b);
    const aPriority = aMeta?.frontmatter?.priority;
    const bPriority = bMeta?.frontmatter?.priority;

    if (aPriority == null && bPriority == null)
      return a.basename.localeCompare(b.basename);
    if (aPriority == null) return 1;
    if (bPriority == null) return -1;
    return aPriority - bPriority;
  });

  return topLevel;
}

export function getChildAreas(app: App, parentName: string): TFile[] {
  return app.vault
    .getFiles()
    .filter((f: TFile) => {
      if (
        !f.path.startsWith("Areas/") ||
        f.extension !== "md" ||
        f.path.split("/").length !== 2
      )
        return false;
      const metadata = app.metadataCache.getFileCache(f);
      const areas = metadata?.frontmatter?.areas;
      if (!areas) return false;
      return normalizeAreasFrontmatter(areas)
        .map(simplifyWikiLink)
        .includes(parentName);
    })
    .sort((a, b) => a.basename.localeCompare(b.basename));
}

export function getAreaHierarchy(app: App): AreaNode[] {
  const topLevel = getTopLevelAreas(app);

  return topLevel.map((file) => {
    const meta = app.metadataCache.getFileCache(file);
    const priority = meta?.frontmatter?.priority ?? null;

    const children = getChildAreas(app, file.basename).map((childFile) => {
      const childMeta = app.metadataCache.getFileCache(childFile);
      const childPriority = childMeta?.frontmatter?.priority ?? null;

      const grandchildren = getChildAreas(app, childFile.basename).map(
        (gcFile) => {
          const gcMeta = app.metadataCache.getFileCache(gcFile);
          return {
            file: gcFile,
            priority: gcMeta?.frontmatter?.priority ?? null,
            children: [],
          };
        },
      );

      return {
        file: childFile,
        priority: childPriority,
        children: grandchildren,
      };
    });

    return { file, priority, children };
  });
}

/** Collect all area names under a node (the node itself + all descendants) */
export function collectAreaNames(node: AreaNode): string[] {
  const names = [node.file.basename];
  for (const child of node.children) {
    names.push(...collectAreaNames(child));
  }
  return names;
}
