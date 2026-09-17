import fs from "node:fs";
import path from "node:path";
import { getWorkspaceStateDirectory } from "../config/paths.js";
import type { TunnelInfo } from "./provider.js";

export function saveTunnelState(workspaceRoot: string, info: TunnelInfo) {
  const dir = getWorkspaceStateDirectory(workspaceRoot);
  const file = path.join(dir, "tunnel.json");
  try {
    fs.writeFileSync(file, JSON.stringify(info, null, 2), "utf-8");
  } catch {
    // ignore write error
  }
}

export function loadTunnelState(workspaceRoot: string): TunnelInfo | null {
  const dir = getWorkspaceStateDirectory(workspaceRoot);
  const file = path.join(dir, "tunnel.json");
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      return null;
    }
  }
  return null;
}

export function clearTunnelState(workspaceRoot: string) {
  const dir = getWorkspaceStateDirectory(workspaceRoot);
  const file = path.join(dir, "tunnel.json");
  if (fs.existsSync(file)) {
    try {
      fs.unlinkSync(file);
    } catch {
      // ignore
    }
  }
}
