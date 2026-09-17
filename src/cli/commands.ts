import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import { BridgeRuntime } from "../bridge/runtime.js";
import { BridgeServer } from "../bridge/server.js";
import { PairingManager } from "../auth/pairing.js";
import { runDoctorChecks, printDoctorReport } from "./doctor.js";
import { GeminiThinkingClient } from "../gemini/client.js";
import { GeminiPlanner } from "../gemini/planner.js";
import { GeminiReviewer } from "../gemini/reviewer.js";
import { WorkspaceManager } from "../workspace/manager.js";
import { getGitDiff, getGitStatus } from "../workspace/git.js";
import { getAntigravitySkillsDirectory } from "../config/paths.js";
import { CloudflaredTunnelProvider } from "../tunnel/cloudflared.js";
import { saveTunnelState, loadTunnelState, clearTunnelState } from "../tunnel/state.js";
import { DEFAULT_PORT, DEFAULT_HOST } from "../config/constants.js";

export async function setupCommand(workspaceRoot: string, options: { apiKey?: string }) {
  console.log(pc.bold("\n🚀 Setting up Antigravity with Gemini (G2A)...\n"));

  // 1. Install Antigravity Skill
  const skillsDir = getAntigravitySkillsDirectory();
  const targetSkillDir = path.join(skillsDir, "antigravity-with-gemini");
  fs.mkdirSync(targetSkillDir, { recursive: true });

  const normalizedSkillSource = fileURLToPath(new URL("../../skill/SKILL.md", import.meta.url));

  const targetSkillPath = path.join(targetSkillDir, "SKILL.md");

  if (fs.existsSync(normalizedSkillSource)) {
    let content = fs.readFileSync(normalizedSkillSource, "utf-8");
    content = content.replace("<WORKSPACE_ROOT>", workspaceRoot);
    fs.writeFileSync(targetSkillPath, content, "utf-8");
    console.log(pc.green(`✓ Skill installed to: ${targetSkillPath}`));
  } else {
    console.log(pc.yellow(`! Local skill file not found at ${normalizedSkillSource}. Skipping copy.`));
  }

  // 2. Doctor checks
  const checks = await runDoctorChecks(workspaceRoot);
  printDoctorReport(checks);

  // 3. Pairing code
  const pairingManager = new PairingManager();
  const code = pairingManager.generateCode(workspaceRoot);
  console.log(pc.cyan(`✓ Workspace initialized.`));
  console.log(pc.bold(`✓ Initial One-Time Pairing Code: `) + pc.bgCyan(pc.black(` ${code} `)));
  console.log(pc.dim("  (Valid for 5 minutes. Use this code to pair your Gemini MCP client)\n"));

  console.log(pc.green(pc.bold("Setup complete! Run `g2a start` to launch the bridge daemon.\n")));
}

export async function startCommand(workspaceRoot: string, options: { foreground?: boolean; port?: number; apiKey?: string }) {
  const runtime = new BridgeRuntime(workspaceRoot);

  if (options.foreground) {
    console.log(pc.bold("\nStarting G2A Bridge Server in foreground..."));
    const port = options.port || DEFAULT_PORT;
    const server = new BridgeServer({
      port,
      host: DEFAULT_HOST,
      workspaceRoot,
      geminiApiKey: options.apiKey || process.env.GEMINI_API_KEY,
    });

    const info = await server.start();
    const code = server.getPairingManager().generateCode(workspaceRoot);

    console.log(pc.green(`✓ Bridge listening at: ${info.url}`));
    console.log(pc.cyan(`✓ SSE endpoint: ${info.url}/mcp`));
    console.log(pc.bold(`✓ Active Pairing Code: `) + pc.bgCyan(pc.black(` ${code} `)));
    console.log(pc.dim("Press Ctrl+C to stop.\n"));

    process.on("SIGINT", async () => {
      console.log("\nStopping server...");
      await server.stop();
      process.exit(0);
    });
    return;
  }

  console.log(pc.bold("\nStarting G2A Bridge Daemon in background..."));
  const status = await runtime.startDaemon({ port: options.port, apiKey: options.apiKey });
  console.log(pc.green(`✓ Bridge started successfully (PID: ${status.pid})`));
  console.log(pc.cyan(`✓ URL: ${status.url}`));
  console.log(pc.dim("Run `g2a status` to view details or `g2a stop` to terminate.\n"));
}

export async function stopCommand(workspaceRoot: string) {
  const runtime = new BridgeRuntime(workspaceRoot);
  const stopped = await runtime.stopDaemon();
  if (stopped) {
    console.log(pc.green("\n✓ G2A Bridge daemon stopped successfully.\n"));
  } else {
    console.log(pc.yellow("\n! No running G2A Bridge daemon found.\n"));
  }
}

export async function statusCommand(workspaceRoot: string) {
  const runtime = new BridgeRuntime(workspaceRoot);
  const status = await runtime.getStatus();
  const tunnel = loadTunnelState(workspaceRoot);

  console.log(pc.bold("\n=== G2A Bridge Status ==="));
  console.log(`Workspace: ${workspaceRoot}`);
  console.log(`Status:    ${status.isRunning ? pc.green("RUNNING") : pc.red("STOPPED")}`);
  if (status.isRunning) {
    console.log(`PID:       ${status.pid}`);
    console.log(`Local URL: ${status.url}`);
    console.log(`SSE URL:   ${status.url}/mcp`);
  }
  if (tunnel) {
    console.log(`Tunnel:    ${pc.cyan(tunnel.url)} (${tunnel.provider})`);
  }
  console.log();
}

export async function pairCommand(workspaceRoot: string) {
  const pairingManager = new PairingManager();
  const code = pairingManager.generateCode(workspaceRoot);
  console.log(pc.bold("\n🔑 Generated New Pairing Code: ") + pc.bgCyan(pc.black(` ${code} `)));
  console.log(pc.dim("Valid for 5 minutes. Enter this code in your Gemini connector settings.\n"));
}

export async function planCommand(workspaceRoot: string, task: string) {
  console.log(pc.bold(`\n🧠 Asking Gemini Thinking to plan for: "${task}"...\n`));
  const client = new GeminiThinkingClient();
  const planner = new GeminiPlanner(client);
  const workspace = new WorkspaceManager(workspaceRoot);

  const info = workspace.getInfo();
  const gitStatus = getGitStatus(workspaceRoot);
  const summary = `Project: ${info.name}, Branch: ${info.branch || "unknown"}, Package Manager: ${info.packageManager}, Frameworks: ${info.frameworks.join(", ")}`;

  try {
    const plan = await planner.createPlan({
      task,
      workspaceSummary: summary,
      gitStatus: gitStatus.summary,
    });
    console.log(plan.rawMarkdown);
    console.log();
  } catch (err: any) {
    console.error(pc.red(`Planning failed: ${err?.message || err}`));
  }
}

export async function reviewCommand(workspaceRoot: string, taskDescription?: string) {
  console.log(pc.bold("\n🔍 Asking Gemini to review current git diff...\n"));
  const client = new GeminiThinkingClient();
  const reviewer = new GeminiReviewer(client);

  const diff = getGitDiff(workspaceRoot);
  if (!diff || diff === "(No diff)") {
    console.log(pc.yellow("No git diff detected to review. Modify files first.\n"));
    return;
  }

  try {
    const review = await reviewer.reviewDiff({
      gitDiff: diff,
      taskDescription: taskDescription || "Review latest changes in workspace",
    });
    console.log(review.rawMarkdown);
    console.log();
  } catch (err: any) {
    console.error(pc.red(`Review failed: ${err?.message || err}`));
  }
}

export async function tunnelCommand(workspaceRoot: string, options: { stop?: boolean }) {
  if (options.stop) {
    clearTunnelState(workspaceRoot);
    console.log(pc.green("\n✓ Cloudflare tunnel state cleared.\n"));
    return;
  }

  const runtime = new BridgeRuntime(workspaceRoot);
  const status = await runtime.getStatus();
  if (!status.isRunning || !status.port) {
    console.log(pc.red("\nError: Bridge daemon must be running before starting a tunnel. Run `g2a start` first.\n"));
    return;
  }

  console.log(pc.bold(`\n🌐 Launching Cloudflare Quick Tunnel to port ${status.port}...`));
  const provider = new CloudflaredTunnelProvider();
  try {
    const info = await provider.start(status.port);
    saveTunnelState(workspaceRoot, info);
    console.log(pc.green(`✓ Public Tunnel URL: ${pc.bold(info.url)}`));
    console.log(pc.cyan(`✓ Public SSE Endpoint: ${info.url}/mcp\n`));
  } catch (err: any) {
    console.error(pc.red(`Tunnel error: ${err?.message || err}\n`));
  }
}
