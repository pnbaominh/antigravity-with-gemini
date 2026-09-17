import { spawn, type ChildProcess } from "node:child_process";
import { type TunnelProvider, type TunnelInfo } from "./provider.js";

export class CloudflaredTunnelProvider implements TunnelProvider {
  private process: ChildProcess | null = null;
  private currentInfo: TunnelInfo | null = null;

  async start(localPort: number): Promise<TunnelInfo> {
    if (this.currentInfo) {
      return this.currentInfo;
    }

    return new Promise((resolve, reject) => {
      const child = spawn(
        "cloudflared",
        ["tunnel", "--url", `http://127.0.0.1:${localPort}`],
        {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        }
      );

      this.process = child;
      let urlFound = false;

      const handleOutput = (data: Buffer) => {
        const text = data.toString();
        // Look for trycloudflare.com URL
        const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match && !urlFound) {
          urlFound = true;
          this.currentInfo = {
            url: match[0],
            provider: "cloudflare-quick",
            createdAt: new Date().toISOString(),
            pid: child.pid,
          };
          resolve(this.currentInfo);
        }
      };

      child.stdout?.on("data", handleOutput);
      child.stderr?.on("data", handleOutput);

      child.on("error", (err) => {
        if (!urlFound) {
          reject(
            new Error(
              `cloudflared failed to start: ${err.message}. Ensure cloudflared is installed (winget install Cloudflare.cloudflared).`
            )
          );
        }
      });

      child.on("exit", (code) => {
        this.currentInfo = null;
        this.process = null;
        if (!urlFound) {
          reject(new Error(`cloudflared exited early with code ${code}.`));
        }
      });

      // Timeout after 20 seconds
      setTimeout(() => {
        if (!urlFound) {
          this.stop();
          reject(new Error("Timeout waiting for cloudflared tunnel URL."));
        }
      }, 20000);
    });
  }

  async stop(): Promise<void> {
    if (this.process && this.process.pid) {
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", this.process.pid.toString(), "/f", "/t"]);
        } else {
          this.process.kill("SIGTERM");
        }
      } catch {
        // ignore kill error
      }
    }
    this.process = null;
    this.currentInfo = null;
  }

  getStatus(): TunnelInfo | null {
    return this.currentInfo;
  }
}
