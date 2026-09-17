import fs from "node:fs";
import path from "node:path";
import { resolveSafePath, isSensitiveFile } from "./sanitize.js";
import { createWorkspaceIgnoreFilter } from "./ignore.js";

export interface SearchMatch {
  file: string;
  line: number;
  content: string;
}

export interface SearchOptions {
  isRegex?: boolean;
  caseSensitive?: boolean;
  maxResults?: number;
  subDir?: string;
}

export function searchWorkspace(
  workspaceRoot: string,
  query: string,
  options: SearchOptions = {}
): SearchMatch[] {
  const root = path.resolve(workspaceRoot);
  const ignoreFilter = createWorkspaceIgnoreFilter(root);
  const matches: SearchMatch[] = [];
  const maxResults = options.maxResults || 100;

  let pattern: RegExp;
  try {
    const flags = options.caseSensitive ? "g" : "gi";
    pattern = options.isRegex
      ? new RegExp(query, flags)
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
  } catch {
    throw new Error(`Invalid search query/regex: "${query}"`);
  }

  const startDir = options.subDir ? resolveSafePath(root, options.subDir).safePath : root;

  const searchDir = (dir: string) => {
    if (matches.length >= maxResults) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (matches.length >= maxResults) break;

      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(root, fullPath).replace(/\\/g, "/");

      if (ignoreFilter.ignores(relPath)) continue;

      if (entry.isDirectory()) {
        searchDir(fullPath);
      } else if (entry.isFile()) {
        if (isSensitiveFile(relPath)) continue;

        // Skip binary files based on extension or size (> 2MB)
        const ext = path.extname(entry.name).toLowerCase();
        if ([".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".zip", ".tar", ".gz", ".exe", ".bin"].includes(ext)) {
          continue;
        }

        try {
          const stats = fs.statSync(fullPath);
          if (stats.size > 2 * 1024 * 1024) continue;

          const content = fs.readFileSync(fullPath, "utf-8");
          const lines = content.split(/\r?\n/);

          for (let i = 0; i < lines.length; i++) {
            pattern.lastIndex = 0;
            if (pattern.test(lines[i])) {
              matches.push({
                file: relPath,
                line: i + 1,
                content: lines[i].trim(),
              });
              if (matches.length >= maxResults) break;
            }
          }
        } catch {
          // ignore unreadable files
        }
      }
    }
  };

  searchDir(startDir);
  return matches;
}
