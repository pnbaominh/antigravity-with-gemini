import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { WorkspaceManager } from "../workspace/manager.js";
import { getGitStatus, getGitDiff } from "../workspace/git.js";
import { searchWorkspace } from "../workspace/search.js";
import { getExecutionSummary, getExecutionOutput, getTestStatus } from "../execution/output.js";
import { GeminiThinkingClient } from "../gemini/client.js";
import { registerThinkingTools } from "./thinking-tools.js";

export function createG2AMcpServer(
  workspaceRoot: string,
  options: { geminiClient?: GeminiThinkingClient } = {}
): McpServer {
  const server = new McpServer({
    name: "antigravity-with-gemini",
    version: "1.0.0",
  });

  const workspace = new WorkspaceManager(workspaceRoot);

  // 1. workspace_info
  server.tool(
    "workspace_info",
    "Get high-level information about the current workspace (root path, git branch, package manager, detected frameworks).",
    {},
    async () => {
      try {
        const info = workspace.getInfo();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(info, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error fetching workspace info: ${error?.message}` }],
        };
      }
    }
  );

  // 2. list_directory
  server.tool(
    "list_directory",
    "List directory files and folders safely, respecting .gitignore and .g2aignore.",
    {
      subDir: z.string().optional().default("").describe("Subdirectory relative to workspace root"),
      maxDepth: z.number().optional().default(3).describe("Maximum directory depth (default: 3)"),
    },
    async ({ subDir, maxDepth }: { subDir?: string; maxDepth?: number }) => {
      try {
        const items = workspace.listDirectory(subDir, maxDepth);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(items, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error listing directory: ${error?.message}` }],
        };
      }
    }
  );

  // 3. read_file
  server.tool(
    "read_file",
    "Read content from a workspace file with line slicing. Sensitive files (.env, keys) are strictly blocked.",
    {
      filePath: z.string().describe("Relative path to file within workspace"),
      startLine: z.number().optional().default(1).describe("First line to read (1-indexed)"),
      endLine: z.number().optional().describe("Last line to read (inclusive)"),
    },
    async ({ filePath, startLine, endLine }: { filePath: string; startLine?: number; endLine?: number }) => {
      try {
        const result = workspace.readFile(filePath, startLine, endLine);
        return {
          content: [
            {
              type: "text",
              text: result.content,
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error reading file "${filePath}": ${error?.message}` }],
        };
      }
    }
  );

  // 4. search_workspace
  server.tool(
    "search_workspace",
    "Search text or regex pattern across workspace files, respecting ignore rules and skipping sensitive files.",
    {
      query: z.string().describe("Search string or regex pattern"),
      isRegex: z.boolean().optional().default(false).describe("Whether query is a regular expression"),
      caseSensitive: z.boolean().optional().default(false).describe("Case-sensitive match"),
      maxResults: z.number().optional().default(50).describe("Maximum number of results to return"),
    },
    async ({
      query,
      isRegex,
      caseSensitive,
      maxResults,
    }: {
      query: string;
      isRegex?: boolean;
      caseSensitive?: boolean;
      maxResults?: number;
    }) => {
      try {
        const results = searchWorkspace(workspaceRoot, query, {
          isRegex,
          caseSensitive,
          maxResults,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Search failed: ${error?.message}` }],
        };
      }
    }
  );

  // 5. git_status
  server.tool(
    "git_status",
    "Get current git status for the workspace (branch, staged, unstaged, untracked changes).",
    {},
    async () => {
      try {
        const status = getGitStatus(workspaceRoot);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(status, null, 2),
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Git status error: ${error?.message}` }],
        };
      }
    }
  );

  // 6. git_diff
  server.tool(
    "git_diff",
    "Get the git diff for changes in the workspace. Crucial for reviewing what Antigravity modified.",
    {
      staged: z.boolean().optional().default(false).describe("View staged diff only"),
      file: z.string().optional().describe("View diff for a specific file"),
    },
    async ({ staged, file }: { staged?: boolean; file?: string }) => {
      try {
        const diff = getGitDiff(workspaceRoot, { staged, file });
        return {
          content: [
            {
              type: "text",
              text: diff,
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Git diff error: ${error?.message}` }],
        };
      }
    }
  );

  // 7. test_status
  server.tool(
    "test_status",
    "Get test execution results and output from the most recent test run.",
    {},
    async () => {
      try {
        const status = getTestStatus(workspaceRoot);
        return {
          content: [{ type: "text", text: status }],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Test status error: ${error?.message}` }],
        };
      }
    }
  );

  // 8. execution_summary
  server.tool(
    "execution_summary",
    "Get an overview summary of Antigravity's current/recent execution session.",
    {},
    async () => {
      try {
        const summary = getExecutionSummary(workspaceRoot);
        return {
          content: [{ type: "text", text: summary }],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Execution summary error: ${error?.message}` }],
        };
      }
    }
  );

  // 9. execution_output
  server.tool(
    "execution_output",
    "Inspect the detailed stdout/stderr and exit codes from commands executed by Antigravity.",
    {
      commandIndex: z.number().optional().describe("Index of the command to inspect"),
    },
    async ({ commandIndex }: { commandIndex?: number }) => {
      try {
        const output = getExecutionOutput(workspaceRoot, commandIndex);
        return {
          content: [{ type: "text", text: output }],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Execution output error: ${error?.message}` }],
        };
      }
    }
  );

  // Always register Gemini thinking tools (gemini_plan, gemini_review, gemini_think)
  const geminiClient = options.geminiClient ?? new GeminiThinkingClient();
  registerThinkingTools(server, workspaceRoot, geminiClient);

  return server;
}
