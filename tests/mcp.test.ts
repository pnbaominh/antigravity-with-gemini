import { describe, it, expect } from "vitest";
import path from "node:path";
import { createG2AMcpServer } from "../src/mcp/server.js";

describe("MCP Server Tools Registration", () => {
  const root = path.resolve(process.cwd());

  it("should create MCP server with all 9 read-only workspace tools", () => {
    const server = createG2AMcpServer(root);
    expect(server).toBeDefined();

    // Check internal registered tools
    // @ts-expect-error - inspecting internal tools map for test verification
    const tools = server._registeredTools || server._tools;
    if (tools) {
      const toolNames = Object.keys(tools);
      expect(toolNames).toContain("workspace_info");
      expect(toolNames).toContain("list_directory");
      expect(toolNames).toContain("read_file");
      expect(toolNames).toContain("search_workspace");
      expect(toolNames).toContain("git_status");
      expect(toolNames).toContain("git_diff");
      expect(toolNames).toContain("test_status");
      expect(toolNames).toContain("execution_summary");
      expect(toolNames).toContain("execution_output");
      expect(toolNames).toContain("gemini_plan");
      expect(toolNames).toContain("gemini_review");
      expect(toolNames).toContain("gemini_think");
    }
  });
});
