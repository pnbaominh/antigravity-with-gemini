import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

export interface GitStatusResult {
  isGitRepo: boolean;
  branch: string | null;
  hasChanges: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  summary: string;
}

export function getGitBranch(workspaceRoot: string): string | null {
  try {
    const gitDir = path.join(workspaceRoot, ".git");
    if (!fs.existsSync(gitDir)) return null;

    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: workspaceRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    return branch || null;
  } catch {
    return null;
  }
}

export function getGitStatus(workspaceRoot: string): GitStatusResult {
  try {
    const gitDir = path.join(workspaceRoot, ".git");
    if (!fs.existsSync(gitDir)) {
      return {
        isGitRepo: false,
        branch: null,
        hasChanges: false,
        staged: [],
        unstaged: [],
        untracked: [],
        summary: "Not a git repository",
      };
    }

    const branch = getGitBranch(workspaceRoot);
    const output = execSync("git status --porcelain", {
      cwd: workspaceRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });

    const lines = output.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];

    for (const line of lines) {
      const x = line[0];
      const y = line[1];
      const file = line.slice(3).trim();

      if (x === "?" && y === "?") {
        untracked.push(file);
      } else {
        if (x !== " " && x !== "?") staged.push(file);
        if (y !== " " && y !== "?") unstaged.push(file);
      }
    }

    const hasChanges = staged.length > 0 || unstaged.length > 0 || untracked.length > 0;
    const summary = hasChanges
      ? `${staged.length} staged, ${unstaged.length} unstaged, ${untracked.length} untracked`
      : "Working tree clean";

    return {
      isGitRepo: true,
      branch,
      hasChanges,
      staged,
      unstaged,
      untracked,
      summary,
    };
  } catch (error: any) {
    return {
      isGitRepo: false,
      branch: null,
      hasChanges: false,
      staged: [],
      unstaged: [],
      untracked: [],
      summary: `Git status error: ${error?.message || String(error)}`,
    };
  }
}

export function getGitDiff(
  workspaceRoot: string,
  options: { staged?: boolean; file?: string } = {}
): string {
  try {
    const args = ["diff"];
    if (options.staged) {
      args.push("--staged");
    }
    if (options.file) {
      args.push("--", options.file);
    }

    const diff = execSync(`git ${args.join(" ")}`, {
      cwd: workspaceRoot,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["pipe", "pipe", "ignore"],
    });

    return diff || "(No diff)";
  } catch (error: any) {
    return `Error running git diff: ${error?.message || String(error)}`;
  }
}

export function getRecentCommits(workspaceRoot: string, limit: number = 5): string[] {
  try {
    const output = execSync(`git log -n ${limit} --oneline`, {
      cwd: workspaceRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return output.split(/\r?\n/).filter((l) => l.trim().length > 0);
  } catch {
    return [];
  }
}
