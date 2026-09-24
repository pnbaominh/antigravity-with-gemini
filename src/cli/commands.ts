import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import { BridgeRuntime } from "../bridge/runtime.js";
import { BridgeServer } from "../bridge/server.js";
import { PairingManager } from "../auth/pairing.js";
import { runDoctorChecks, printDoctorReport } from "./doctor.js";
import { GeminiThinkingClient, createDefaultClient } from "../gemini/client.js";
import { GeminiWebClient } from "../browser/gemini-web-client.js";
import { GeminiPlanner } from "../gemini/planner.js";
import { GeminiReviewer } from "../gemini/reviewer.js";
import { WorkspaceManager } from "../workspace/manager.js";
import { getGitDiff, getGitStatus } from "../workspace/git.js";
import { getAntigravitySkillsDirectory, getAntigravityMcpConfigPath, saveGeminiApiKey } from "../config/paths.js";
import { writeAntigravityMcpSchemas } from "../mcp/schemas.js";
import { runMcpStdio } from "../mcp/stdio.js";
import { CloudflaredTunnelProvider } from "../tunnel/cloudflared.js";
import { saveTunnelState, loadTunnelState, clearTunnelState } from "../tunnel/state.js";
import { DEFAULT_PORT, DEFAULT_HOST, DEFAULT_GEMINI_MODELS } from "../config/constants.js";
import { PlanHistoryStore } from "../gemini/history.js";
import { DynamicModelRegistry } from "../gemini/model-registry.js";

export async function setupCommand(workspaceRoot: string, options: { apiKey?: string }) {
  console.log(pc.bold("\n🚀 Setting up Antigravity with Gemini (G2A)...\n"));

  if (options.apiKey) {
    process.env.GEMINI_API_KEY = options.apiKey;
    saveGeminiApiKey(options.apiKey);
  }

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

  // 2. Register in Antigravity mcp_config.json
  const mcpConfigPath = getAntigravityMcpConfigPath();
  try {
    let mcpConfig: any = { mcpServers: {} };
    if (fs.existsSync(mcpConfigPath)) {
      mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, "utf-8"));
      if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
    }
    const cliEntry = path.resolve(fileURLToPath(new URL("../../dist/cli/index.js", import.meta.url)));
    mcpConfig.mcpServers["antigravity-with-gemini"] = {
      command: "node",
      args: [cliEntry, "mcp"],
      env: options.apiKey ? { GEMINI_API_KEY: options.apiKey } : undefined,
    };
    fs.mkdirSync(path.dirname(mcpConfigPath), { recursive: true });
    fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), "utf-8");
    console.log(pc.green(`✓ Registered in Antigravity MCP config: ${mcpConfigPath}`));
  } catch (err: any) {
    console.log(pc.yellow(`! Could not update mcp_config.json: ${err?.message}`));
  }

  // 3. Generate Antigravity MCP tool schemas
  try {
    const written = writeAntigravityMcpSchemas();
    console.log(pc.green(`✓ Generated ${written.length} Antigravity MCP tool schemas.`));
  } catch (err: any) {
    console.log(pc.yellow(`! Could not generate MCP schemas: ${err?.message}`));
  }

  // 4. Doctor checks
  const checks = await runDoctorChecks(workspaceRoot);
  printDoctorReport(checks);

  // 5. Pairing code
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

export async function loginWebCommand(workspaceRoot: string) {
  console.log(pc.bold("\n🌐 Google Gemini Web Login\n"));
  const webClient = new GeminiWebClient();
  try {
    const executable = webClient.getExecutablePath();
    console.log(pc.cyan(`Using Chromium Browser: ${executable}`));
    console.log(pc.dim(`Profile Directory: ${webClient.getUserDataDir()}`));

    await webClient.startInteractiveLogin((msg) => {
      console.log(pc.yellow(msg));
    });

    console.log(pc.green("\n✓ Google Gemini Web session established and saved successfully!"));
    console.log(pc.white("Now you can run `g2a plan` or call `gemini_plan` without any API keys or quota limits.\n"));
  } catch (err: any) {
    console.error(pc.red(`\nLogin failed: ${err?.message || err}\n`));
  } finally {
    await webClient.close();
  }
}

export async function planCommand(
  workspaceRoot: string,
  task: string,
  options?: { model?: string; continue?: boolean }
) {
  console.log(pc.bold(`\n🧠 Asking Gemini Thinking to plan for: "${task}"...`));
  if (options?.model) {
    console.log(pc.cyan(`Using requested model: ${options.model}`));
  }
  if (options?.continue) {
    console.log(pc.green(`Continuing in active Gemini Web conversation thread...`));
  }
  console.log();
  const client = createDefaultClient(options?.model);
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
      workspaceRoot,
      model: options?.model,
      continueConversation: options?.continue,
    });

    const historyStore = new PlanHistoryStore(workspaceRoot);
    historyStore.savePlan({
      task,
      source: "cli",
      model: "gemini-web",
      title: plan.title,
      summary: plan.summary,
      phases: plan.phases,
      rawMarkdown: plan.rawMarkdown,
    });

    console.log(plan.rawMarkdown);
    console.log();
  } catch (err: any) {
    console.error(pc.red(`Planning failed: ${err?.message || err}`));
  } finally {
    if ((client as any).close) {
      await (client as any).close();
    }
  }
}

export async function reviewCommand(workspaceRoot: string, taskDescription?: string) {
  console.log(pc.bold("\n🔍 Asking Gemini to review current git diff...\n"));
  const client = createDefaultClient();
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
  } finally {
    if ((client as any).close) {
      await (client as any).close();
    }
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

export async function mcpCommand(workspaceRoot: string, options: { apiKey?: string }) {
  await runMcpStdio(workspaceRoot, options);
}

export async function webCommand(workspaceRoot: string, task?: string) {
  const workspace = new WorkspaceManager(workspaceRoot);
  const info = workspace.getInfo();
  const gitStatus = getGitStatus(workspaceRoot);

  const promptText = `Bạn là một Principal Software Architect và Lead Engineering Planner hàng đầu.
Nhiệm vụ của bạn là: "Gemini Thinks. Antigravity Works."
Tôi đang dùng Antigravity (Advanced Agentic Coding Agent) để tự động viết mã và thi công dự án.
Hãy lên một kế hoạch chi tiết, có tư duy kiến trúc sâu, đánh giá trade-offs, chỉ rõ từng file [NEW], [MODIFY], [DELETE], [TEST], cảnh báo các bẫy kỹ thuật (concurrency, race conditions, Windows CRLF vs POSIX, rate limits), chia thành các Phase nguyên tử kèm lệnh Verification cụ thể.

THÔNG TIN WORKSPACE HIỆN TẠI:
- Dự án: ${info.name}
- Thư mục: ${info.root}
- Nhánh Git: ${info.branch || "main"}
- Trình quản lý gói: ${info.packageManager}
- Frameworks: ${info.frameworks.join(", ") || "none"}
${gitStatus.summary ? `\nTRẠNG THÁI GIT:\n${gitStatus.summary}\n` : ""}

NHIỆM VỤ CẦN LẬP KẾ HOẠCH:
${task || "Phân tích và tối ưu hóa kiến trúc dự án hiện tại"}

Hãy xuất kế hoạch theo chuẩn 5 phần nghiêm ngặt:
# Plan: [Tên kế hoạch]
## 1. Executive Summary & Architecture Strategy
## 2. File-by-File Technical Specification
## 3. Deep Technical Traps, Edge Cases & Guardrails
## 4. Phased Implementation Plan (### Phase 1, ### Phase 2...)
## 5. Acceptance Criteria & Quality Gates`;

  // Copy to clipboard
  try {
    if (process.platform === "win32") {
      const child = spawn("powershell", ["-NoProfile", "-Command", "$input | Set-Clipboard"], {
        stdio: ["pipe", "ignore", "ignore"],
      });
      child.stdin.write(promptText, "utf8");
      child.stdin.end();
    } else if (process.platform === "darwin") {
      const child = spawn("pbcopy", [], { stdio: ["pipe", "ignore", "ignore"] });
      child.stdin.write(promptText, "utf8");
      child.stdin.end();
    } else {
      const child = spawn("xclip", ["-selection", "clipboard"], { stdio: ["pipe", "ignore", "ignore"] });
      child.stdin.write(promptText, "utf8");
      child.stdin.end();
    }
  } catch {}

  // Open Gemini Web URL in default browser
  const geminiUrl = "https://gemini.google.com/app?hl=vi";
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", geminiUrl]);
    } else if (process.platform === "darwin") {
      spawn("open", [geminiUrl]);
    } else {
      spawn("xdg-open", [geminiUrl]);
    }
  } catch {}

  console.log(pc.bold("\n🌐 Google Gemini Web Bridge:\n"));
  console.log(pc.green("✓ Đã tự động sao chép Prompt & Ngữ cảnh Workspace vào Clipboard!"));
  console.log(pc.cyan(`✓ Đã mở Google Gemini Web: ${geminiUrl}`));
  console.log(pc.bold("\n👉 Cách thực hiện cực kỳ đơn giản:"));
  console.log(pc.white("1. Trình duyệt đã mở màn hình chat ") + pc.bold(pc.cyan("Google Gemini Web")) + pc.white("."));
  console.log(pc.white("2. Bạn chỉ cần nhấn ") + pc.yellow(pc.bold("Ctrl + V")) + pc.white(" vào ô chat và nhấn ") + pc.yellow(pc.bold("Enter")) + pc.white("."));
  console.log(pc.white("3. Bạn sẽ thấy Gemini Thinking suy nghĩ và gõ trực tiếp từng dòng plan trên giao diện web của Google!"));
  console.log(pc.white("4. Sau khi có plan, chỉ cần copy nội dung dán vào chat với Antigravity để bắt đầu tự động thi công code.\n"));
}

export async function modelsCommand(options: { refresh?: boolean }) {
  console.log(pc.bold("\n🔍 Inspecting Gemini Models Registry (Strictly > 3.0)...\n"));

  const client = new GeminiThinkingClient();
  const registry = DynamicModelRegistry.getInstance();
  const raw = client.getRawClient();

  const data = await registry.discoverModels(raw || undefined, options.refresh);

  console.log(pc.bold(`Discovered At: `) + pc.cyan(data.discoveredAt));
  console.log(pc.bold(`Active Modern Models (> 3.0):`));
  for (const m of data.models) {
    const throttled = registry.isThrottled(m.id);
    const statusText = throttled ? pc.yellow(" [Throttled / 429 Cooldown]") : pc.green(" [Active]");
    console.log(`  ${pc.cyan("•")} ${pc.bold(m.id)} (v${m.version}, Tier: ${m.tier})${statusText}`);
  }

  if (data.discardedLegacyModels.length > 0) {
    console.log(pc.dim(`\nDiscarded Legacy Models (<= 3.0 or non-text):`));
    for (const d of data.discardedLegacyModels.slice(0, 8)) {
      console.log(pc.dim(`  ✕ ${d}`));
    }
    if (data.discardedLegacyModels.length > 8) {
      console.log(pc.dim(`  ...and ${data.discardedLegacyModels.length - 8} more`));
    }
  }
  console.log("");
}

