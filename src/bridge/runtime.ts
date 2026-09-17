import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execSync } from "node:child_process";
import { getWorkspaceStateDirectory } from "../config/paths.js";
import { DEFAULT_PORT } from "../config/constants.js";
import { findAvailablePort } from "./port.js";

function isProcessAlive(pid: number): boolean {
  if (process.platform === "win32") {
    try {
      const stdout = execSync(`tasklist /fi "PID eq ${pid}" /fo csv /nh`, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return stdout.toLowerCase().includes(`"${pid}"`);
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}


async function probeBridge(port: number, workspaceRoot: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const body: any = await res.json();
    return body.status === "ok" && path.resolve(body.workspace) === path.resolve(workspaceRoot);
  } catch {
    return false;
  }
}

export interface DaemonStatus {
  isRunning: boolean;
  pid?: number;
  port?: number;
  url?: string;
  workspaceRoot?: string;
}

export class BridgeRuntime {
  private workspaceRoot: string;
  private stateDir: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.stateDir = getWorkspaceStateDirectory(this.workspaceRoot);
  }

  async getStatus(): Promise<DaemonStatus> {
    const pidFile = path.join(this.stateDir, "daemon.json");
    if (!fs.existsSync(pidFile)) {
      return { isRunning: false };
    }

    try {
      const data = JSON.parse(fs.readFileSync(pidFile, "utf-8"));
      if (!data.port) return { isRunning: false };

      // Verify via HTTP health probe and process table
      const isHealthy = await probeBridge(data.port, this.workspaceRoot);
      const isAlive = data.pid ? isProcessAlive(data.pid) : false;

      if (!isHealthy && !isAlive) {
        try { fs.unlinkSync(pidFile); } catch {}
        return { isRunning: false };
      }

      return {
        isRunning: isHealthy || isAlive,
        pid: data.pid,
        port: data.port,
        url: data.url,
        workspaceRoot: data.workspaceRoot,
      };
    } catch {
      return { isRunning: false };
    }
  }

  async startDaemon(options: { port?: number; apiKey?: string } = {}): Promise<DaemonStatus> {
    const status = await this.getStatus();
    if (status.isRunning) {
      return status;
    }

    const preferredPort = options.port || DEFAULT_PORT;
    const port = await findAvailablePort(preferredPort);

    // Resolve path to CLI script
    const normalizedCliPath = fileURLToPath(new URL("../cli/index.js", import.meta.url));

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      G2A_WORKSPACE: this.workspaceRoot,
      G2A_PORT: port.toString(),
      G2A_DAEMON_MODE: "1",
    };

    if (options.apiKey) {
      env.GEMINI_API_KEY = options.apiKey;
    }

    const child = spawn(process.execPath, [normalizedCliPath, "start-internal"], {
      detached: true,
      stdio: "ignore",
      cwd: this.workspaceRoot,
      env,
      windowsHide: true,
    });

    child.unref();

    const daemonData = {
      pid: child.pid,
      port,
      url: `http://127.0.0.1:${port}`,
      workspaceRoot: this.workspaceRoot,
      startedAt: new Date().toISOString(),
    };

    const pidFile = path.join(this.stateDir, "daemon.json");
    fs.writeFileSync(pidFile, JSON.stringify(daemonData, null, 2), "utf-8");

    // Wait a brief moment to ensure startup
    await new Promise((resolve) => setTimeout(resolve, 800));

    return {
      isRunning: true,
      pid: child.pid,
      port,
      url: daemonData.url,
      workspaceRoot: this.workspaceRoot,
    };
  }

  async stopDaemon(): Promise<boolean> {
    const status = await this.getStatus();
    if (!status.isRunning || !status.pid) {
      return false;
    }

    try {
      if (process.platform === "win32") {
        try {
          execSync(`taskkill /pid ${status.pid} /f /t`, { stdio: "ignore" });
        } catch {
          // ignore
        }
      } else {
        process.kill(status.pid, "SIGTERM");
      }
    } catch {
      // ignore
    }

    const pidFile = path.join(this.stateDir, "daemon.json");
    if (fs.existsSync(pidFile)) {
      try {
        fs.unlinkSync(pidFile);
      } catch {
        // ignore
      }
    }

    return true;
  }
}
