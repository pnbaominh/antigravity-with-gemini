#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import dotenv from "dotenv";
import {
  setupCommand,
  loginWebCommand,
  startCommand,
  stopCommand,
  statusCommand,
  pairCommand,
  planCommand,
  reviewCommand,
  tunnelCommand,
  mcpCommand,
  webCommand,
  modelsCommand,
} from "./commands.js";
import { runDoctorChecks, printDoctorReport } from "./doctor.js";
import { BridgeServer } from "../bridge/server.js";
import { DEFAULT_PORT, DEFAULT_HOST } from "../config/constants.js";
import { getSavedGeminiApiKey } from "../config/paths.js";

// Load .env if present in current working directory
dotenv.config();

const program = new Command();

program
  .name("g2a")
  .description("Gemini thinks. Antigravity works. Bridge & MCP Server for Gemini and Antigravity.")
  .version("1.0.0")
  .option("-w, --workspace <path>", "Workspace root directory", process.cwd());

program
  .command("setup")
  .description("Initialize G2A, install Antigravity skill, run health checks and generate pairing code")
  .option("--api-key <key>", "Google Gemini API Key")
  .action(async (options) => {
    const ws = path.resolve(program.opts().workspace);
    await setupCommand(ws, options);
  });

program
  .command("start")
  .description("Start the G2A Bridge MCP server")
  .option("-f, --foreground", "Run in foreground instead of background daemon")
  .option("-p, --port <number>", "Port to bind", (val) => parseInt(val, 10))
  .option("--api-key <key>", "Google Gemini API Key")
  .action(async (options) => {
    const ws = path.resolve(program.opts().workspace);
    await startCommand(ws, options);
  });

program
  .command("stop")
  .description("Stop the background G2A Bridge daemon")
  .action(async () => {
    const ws = path.resolve(program.opts().workspace);
    await stopCommand(ws);
  });

program
  .command("status")
  .description("Show current status of the G2A Bridge and active endpoints")
  .action(async () => {
    const ws = path.resolve(program.opts().workspace);
    await statusCommand(ws);
  });

program
  .command("doctor")
  .description("Diagnose environment, Node.js, git, cloudflared, and permissions")
  .action(async () => {
    const ws = path.resolve(program.opts().workspace);
    const checks = await runDoctorChecks(ws);
    printDoctorReport(checks);
  });

program
  .command("pair")
  .description("Generate a new 6-digit CSPRNG one-time pairing code")
  .action(async () => {
    const ws = path.resolve(program.opts().workspace);
    await pairCommand(ws);
  });

program
  .command("plan <task>")
  .description("Ask Gemini Thinking to plan an actionable roadmap for a task")
  .option("-m, --model <model>", "Model to use on Gemini Web: '3.1 Pro', '3.8 Flash', or '3.5 Flash-Lite'")
  .option("-c, --continue", "Continue in the active Gemini Web conversation thread without creating a new chat")
  .action(async (task, options) => {
    const ws = path.resolve(program.opts().workspace);
    await planCommand(ws, task, options);
  });

program
  .command("review [taskDescription]")
  .description("Ask Gemini to perform an adversarial review of current git diff")
  .action(async (taskDescription) => {
    const ws = path.resolve(program.opts().workspace);
    await reviewCommand(ws, taskDescription);
  });

program
  .command("login-web")
  .description("Launch browser to sign in to Google Gemini Web and save persistent session")
  .action(async () => {
    const ws = path.resolve(program.opts().workspace);
    await loginWebCommand(ws);
  });

program
  .command("web [task]")
  .description("Copy project context & Principal Architect prompt to clipboard and open Google Gemini Web")
  .action(async (task) => {
    const ws = path.resolve(program.opts().workspace);
    await webCommand(ws, task);
  });

program
  .command("tunnel")
  .description("Manage Cloudflare public quick tunnel")
  .option("--stop", "Stop or clear tunnel state")
  .action(async (options) => {
    const ws = path.resolve(program.opts().workspace);
    await tunnelCommand(ws, options);
  });

program
  .command("mcp")
  .description("Run G2A MCP server directly over standard I/O (stdio) for MCP hosts like Antigravity")
  .option("--api-key <key>", "Google Gemini API Key")
  .action(async (options) => {
    const ws = path.resolve(program.opts().workspace);
    await mcpCommand(ws, options);
  });


program
  .command("models")
  .description("List discovered modern Gemini models (> 3.0) and inspect registry status")
  .option("-r, --refresh", "Force a live discovery refresh from Google GenAI API")
  .action(async (options) => {
    await modelsCommand(options);
  });

// Internal command used when spawned as detached daemon
program
  .command("start-internal", { hidden: true })
  .action(async () => {
    const ws = process.env.G2A_WORKSPACE || process.cwd();
    const port = parseInt(process.env.G2A_PORT || DEFAULT_PORT.toString(), 10);
    const apiKey = process.env.GEMINI_API_KEY || getSavedGeminiApiKey() || undefined;
    const server = new BridgeServer({
      port,
      host: DEFAULT_HOST,
      workspaceRoot: ws,
      geminiApiKey: apiKey,
    });
    await server.start();
  });

program.parse();
