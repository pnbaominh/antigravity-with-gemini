import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createG2AMcpServer } from "./server.js";
import { GeminiThinkingClient, createDefaultClient } from "../gemini/client.js";

export interface McpStdioOptions {
  apiKey?: string;
}

/**
 * Runs the G2A MCP Server over Standard I/O (stdio).
 * This is the standard transport mode for MCP clients such as Antigravity,
 * Claude Desktop, and Cursor.
 */
export async function runMcpStdio(
  workspaceRoot: string,
  options: McpStdioOptions = {}
): Promise<void> {
  // Ensure that stdout is reserved strictly for MCP JSON-RPC messages.
  // Re-route normal console.log to stderr so logs don't corrupt the protocol stream.
  const originalLog = console.log;
  console.log = (...args: any[]) => {
    console.error("[g2a:stdio]", ...args);
  };

  const defaultModel = process.env.GEMINI_MODEL || "3.8 Flash";
  const geminiClient = options.apiKey ? new GeminiThinkingClient(options.apiKey) : createDefaultClient(defaultModel);
  const server = createG2AMcpServer(workspaceRoot, { geminiClient });
  const transport = new StdioServerTransport();

  // Handle process signals gracefully
  const cleanup = async () => {
    try {
      await server.close();
    } catch {
      // ignore
    } finally {
      console.log = originalLog;
    }
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  await server.connect(transport);
  console.error("[g2a] G2A MCP server running on stdio transport.");
}
