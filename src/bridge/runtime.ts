import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { getWorkspaceStateDirectory } from "../config/paths.js";
import { DEFAULT_PORT } from "../config/constants.js";
import { findAvailablePort } from "./port.js";

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
      if (!data.pid) return { isRunning: false };

      // Check if process is running
      let isAlive = false;
      try {
        process.kill(data.pid, 0);
        isAlive = true;
      } catch {
        isAlive = false;
      }

      if (!isAlive) {
        fs.unlinkSync(pidFile);
        return { isRunning: false };
      }

      return {
        isRunning: true,
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
        spawn("taskkill", ["/pid", status.pid.toString(), "/f", "/t"]);
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
