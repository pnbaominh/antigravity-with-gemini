import fs from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";

const DEFAULT_IGNORES = [
  ".git",
  ".g2a",
  ".gemini",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "*.pyc",
  "__pycache__",
  "*.log",
  ".DS_Store",
  "Thumbs.db",
];

export function createWorkspaceIgnoreFilter(workspaceRoot: string): Ignore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ig = (ignore as any).default ? (ignore as any).default() : ignore();

  // Add default rules
  ig.add(DEFAULT_IGNORES);

  // Read .gitignore if exists
  const gitignorePath = path.join(workspaceRoot, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    try {
      const content = fs.readFileSync(gitignorePath, "utf-8");
      ig.add(content);
    } catch {
      // ignore read errors
    }
  }

  // Read .g2aignore if exists
  const g2aIgnorePath = path.join(workspaceRoot, ".g2aignore");
  if (fs.existsSync(g2aIgnorePath)) {
    try {
      const content = fs.readFileSync(g2aIgnorePath, "utf-8");
      ig.add(content);
    } catch {
      // ignore read errors
    }
  }

  return ig;
}
