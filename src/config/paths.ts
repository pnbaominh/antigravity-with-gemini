import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { APP_NAME } from "./constants.js";

export function getStateDirectory(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const dir = path.join(localAppData, APP_NAME);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  
  const home = os.homedir();
  const dir = path.join(home, ".config", APP_NAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

import crypto from "node:crypto";

export function normalizeWorkspacePath(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function getWorkspaceStateDirectory(workspaceRoot: string): string {
  const baseDir = getStateDirectory();
  const normalized = normalizeWorkspacePath(workspaceRoot);
  const hash = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  const dir = path.join(baseDir, "workspaces", hash);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getGlobalConfigPath(): string {
  return path.join(getStateDirectory(), "config.json");
}

export function getAntigravitySkillsDirectory(): string {
  const home = os.homedir();
  return path.join(home, ".gemini", "config", "skills");
}

export function getAntigravityMcpConfigPath(): string {
  const home = os.homedir();
  return path.join(home, ".gemini", "config", "mcp_config.json");
}

export function getAntigravityMcpDirectory(): string {
  const home = os.homedir();
  return path.join(home, ".gemini", "antigravity", "mcp");
}

export function getSavedGeminiApiKey(): string | null {
  if (process.env.GEMINI_API_KEY) {
    return process.env.GEMINI_API_KEY;
  }
  try {
    const mcpConfigPath = getAntigravityMcpConfigPath();
    if (fs.existsSync(mcpConfigPath)) {
      const config = JSON.parse(fs.readFileSync(mcpConfigPath, "utf-8"));
      const key = config?.mcpServers?.["antigravity-with-gemini"]?.env?.GEMINI_API_KEY;
      if (key) return key;
    }
  } catch {}
  try {
    const globalConfigPath = getGlobalConfigPath();
    if (fs.existsSync(globalConfigPath)) {
      const config = JSON.parse(fs.readFileSync(globalConfigPath, "utf-8"));
      if (config?.geminiApiKey) return config.geminiApiKey;
    }
  } catch {}
  return null;
}

export function saveGeminiApiKey(key: string): void {
  try {
    const globalConfigPath = getGlobalConfigPath();
    let config: any = {};
    if (fs.existsSync(globalConfigPath)) {
      config = JSON.parse(fs.readFileSync(globalConfigPath, "utf-8"));
    }
    config.geminiApiKey = key;
    fs.mkdirSync(path.dirname(globalConfigPath), { recursive: true });
    fs.writeFileSync(globalConfigPath, JSON.stringify(config, null, 2), "utf-8");
  } catch {}
}


