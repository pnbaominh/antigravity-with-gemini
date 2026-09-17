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

export function getWorkspaceStateDirectory(workspaceRoot: string): string {
  const baseDir = getStateDirectory();
  const hash = Buffer.from(path.resolve(workspaceRoot)).toString("hex").slice(0, 16);
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
