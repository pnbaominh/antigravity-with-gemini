import fs from "node:fs";
import path from "node:path";
import { resolveSafePath } from "./sanitize.js";
import { createWorkspaceIgnoreFilter } from "./ignore.js";
import { getGitBranch } from "./git.js";

export interface WorkspaceInfo {
  name: string;
  root: string;
  branch: string | null;
  packageManager: string;
  frameworks: string[];
  totalFilesEstimate: number;
}

export interface ReadFileResult {
  path: string;
  totalLines: number;
  startLine: number;
  endLine: number;
  content: string;
  isTruncated: boolean;
}

export interface DirectoryItem {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
}

export class WorkspaceManager {
  private root: string;
  private ignoreFilter;

  constructor(workspaceRoot: string) {
    this.root = path.resolve(workspaceRoot);
    this.ignoreFilter = createWorkspaceIgnoreFilter(this.root);
  }

  getRoot(): string {
    return this.root;
  }

  getInfo(): WorkspaceInfo {
    const pkgPath = path.join(this.root, "package.json");
    let name = path.basename(this.root);
    let packageManager = "unknown";
    const frameworks: string[] = [];

    if (fs.existsSync(path.join(this.root, "pnpm-lock.yaml"))) {
      packageManager = "pnpm";
    } else if (fs.existsSync(path.join(this.root, "yarn.lock"))) {
      packageManager = "yarn";
    } else if (fs.existsSync(path.join(this.root, "package-lock.json"))) {
      packageManager = "npm";
    }

    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (pkg.name) name = pkg.name;
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.react) frameworks.push("react");
        if (deps.next) frameworks.push("next.js");
        if (deps.vue) frameworks.push("vue");
        if (deps.typescript) frameworks.push("typescript");
        if (deps["@modelcontextprotocol/sdk"]) frameworks.push("mcp");
      } catch {
        // ignore parse error
      }
    }

    return {
      name,
      root: this.root,
      branch: getGitBranch(this.root),
      packageManager,
      frameworks,
      totalFilesEstimate: this.countFiles(this.root, 2),
    };
  }

  listDirectory(subDir: string = "", maxDepth: number = 3): DirectoryItem[] {
    const targetDir = subDir ? resolveSafePath(this.root, subDir).safePath : this.root;
    const items: DirectoryItem[] = [];

    const walk = (currentDir: string, currentDepth: number) => {
      if (currentDepth > maxDepth) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relPath = path.relative(this.root, fullPath).replace(/\\/g, "/");

        if (this.ignoreFilter.ignores(relPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          items.push({
            name: entry.name,
            path: relPath,
            type: "directory",
          });
          walk(fullPath, currentDepth + 1);
        } else if (entry.isFile()) {
          try {
            const stats = fs.statSync(fullPath);
            items.push({
              name: entry.name,
              path: relPath,
              type: "file",
              size: stats.size,
            });
          } catch {
            // skip if stat fails
          }
        }
      }
    };

    walk(targetDir, 1);
    return items;
  }

  readFile(
    targetPath: string,
    startLine: number = 1,
    endLine?: number
  ): ReadFileResult {
    const { safePath, relativePath } = resolveSafePath(this.root, targetPath);

    if (!fs.existsSync(safePath)) {
      throw new Error(`File not found: ${relativePath}`);
    }

    const stat = fs.statSync(safePath);
    if (!stat.isFile()) {
      throw new Error(`Path is not a regular file: ${relativePath}`);
    }

    const content = fs.readFileSync(safePath, "utf-8");
    const lines = content.split(/\r?\n/);
    const totalLines = lines.length;

    const actualStart = Math.max(1, startLine);
    const actualEnd = endLine ? Math.min(totalLines, endLine) : totalLines;

    const slice = lines.slice(actualStart - 1, actualEnd);
    const slicedContent = slice.join("\n");

    return {
      path: relativePath,
      totalLines,
      startLine: actualStart,
      endLine: actualEnd,
      content: slicedContent,
      isTruncated: actualStart > 1 || actualEnd < totalLines,
    };
  }

  private countFiles(dir: string, maxDepth: number, currentDepth: number = 1): number {
    if (currentDepth > maxDepth) return 0;
    let count = 0;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const rel = path.relative(this.root, path.join(dir, entry.name)).replace(/\\/g, "/");
        if (this.ignoreFilter.ignores(rel)) continue;
        if (entry.isFile()) count++;
        else if (entry.isDirectory()) {
          count += this.countFiles(path.join(dir, entry.name), maxDepth, currentDepth + 1);
        }
      }
    } catch {
      // ignore errors
    }
    return count;
  }
}
