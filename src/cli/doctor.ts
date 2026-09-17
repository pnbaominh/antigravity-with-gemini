import { execSync } from "node:child_process";
import fs from "node:fs";
import pc from "picocolors";
import { getGitStatus } from "../workspace/git.js";
import { getStateDirectory, getSavedGeminiApiKey } from "../config/paths.js";
import { BridgeRuntime } from "../bridge/runtime.js";
import { BrowserDetector } from "../browser/detector.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  message: string;
  fixSuggestion?: string;
}

export async function runDoctorChecks(workspaceRoot: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  // 1. Node.js Version
  const nodeVer = process.version;
  const major = parseInt(nodeVer.slice(1).split(".")[0], 10);
  if (major >= 20) {
    checks.push({
      name: "Node.js Version",
      ok: true,
      message: `${nodeVer} (>= 20 required)`,
    });
  } else {
    checks.push({
      name: "Node.js Version",
      ok: false,
      message: `${nodeVer} is unsupported. Please upgrade to Node.js 20 or newer.`,
      fixSuggestion: "Download latest LTS from https://nodejs.org or use nvm/winget.",
    });
  }

  // 2. Git
  try {
    const gitVer = execSync("git --version", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim();
    const gitStatus = getGitStatus(workspaceRoot);
    checks.push({
      name: "Git & Workspace",
      ok: true,
      message: `${gitVer} | ${gitStatus.isGitRepo ? `Branch: ${gitStatus.branch || "main"}` : "Workspace is not a git repository"}`,
    });
  } catch {
    checks.push({
      name: "Git & Workspace",
      ok: false,
      message: "Git executable not found in PATH.",
      fixSuggestion: "Install Git via winget install Git.Git or from https://git-scm.com.",
    });
  }

  // 3. Cloudflared (optional for tunnels)
  try {
    const cfVer = execSync("cloudflared --version", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim();
    checks.push({
      name: "Cloudflared Tunnel",
      ok: true,
      message: cfVer.split("\n")[0],
    });
  } catch {
    checks.push({
      name: "Cloudflared Tunnel",
      ok: true, // Warning only, not a blocker for local stdio/localhost
      message: "cloudflared is not installed (optional, needed only for public URLs with Gemini Web).",
      fixSuggestion: "Run: winget install Cloudflare.cloudflared (or brew install cloudflared).",
    });
  }

  // 4. Gemini Engine (Web Automation vs API)
  const detectedBrowser = BrowserDetector.findBrowser();
  if (detectedBrowser) {
    checks.push({
      name: "Gemini Web Engine",
      ok: true,
      message: `Chromium Browser detected (${detectedBrowser.name}: ${detectedBrowser.executablePath})`,
    });
  } else {
    checks.push({
      name: "Gemini Web Engine",
      ok: false,
      message: "No Chromium browser found (Brave, Chrome, Edge).",
      fixSuggestion: "Install Brave or Google Chrome to use Gemini Web Automation without API keys.",
    });
  }

  const apiKey = getSavedGeminiApiKey();
  if (apiKey) {
    const masked = apiKey.slice(0, 4) + "..." + apiKey.slice(-4);
    checks.push({
      name: "Gemini API Key (Optional Fallback)",
      ok: true,
      message: `Configured (${masked})`,
    });
  }

  // 5. State Directory Permissions
  try {
    const stateDir = getStateDirectory();
    fs.accessSync(stateDir, fs.constants.W_OK);
    checks.push({
      name: "State Directory",
      ok: true,
      message: `Writable at ${stateDir}`,
    });
  } catch (err: any) {
    checks.push({
      name: "State Directory",
      ok: false,
      message: `Permission denied writing to state directory: ${err?.message}`,
      fixSuggestion: "Check folder permissions or run terminal with appropriate access.",
    });
  }

  // 6. Bridge Daemon Status
  const runtime = new BridgeRuntime(workspaceRoot);
  const daemonStatus = await runtime.getStatus();
  checks.push({
    name: "G2A Bridge Daemon",
    ok: true,
    message: daemonStatus.isRunning
      ? `Active on PID ${daemonStatus.pid} (${daemonStatus.url})`
      : "Stopped (Run `g2a start` to launch)",
  });

  return checks;
}

export function printDoctorReport(checks: DoctorCheck[]) {
  console.log(pc.bold("\n=== G2A Bridge Doctor Report ===\n"));
  let hasErrors = false;

  for (const check of checks) {
    const icon = check.ok ? pc.green("✓") : pc.red("✗");
    console.log(`${icon} ${pc.bold(check.name)}: ${check.message}`);
    if (check.fixSuggestion) {
      console.log(`  ${pc.yellow("→")} ${pc.dim(check.fixSuggestion)}`);
    }
    if (!check.ok) hasErrors = true;
  }

  console.log();
  if (hasErrors) {
    console.log(pc.red("Some checks failed. Follow the suggestions above to resolve issues.\n"));
  } else {
    console.log(pc.green("All core prerequisites look great! Ready to think and work.\n"));
  }
}
