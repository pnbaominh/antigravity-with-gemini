import fs from "node:fs";
import path from "node:path";
import { getAntigravityMcpDirectory } from "../config/paths.js";

export const TOOL_SCHEMAS: Record<string, any> = {
  workspace_info: {
    name: "workspace_info",
    description: "Get high-level information about the current workspace (root path, git branch, package manager, detected frameworks).",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  list_directory: {
    name: "list_directory",
    description: "List directory files and folders safely, respecting .gitignore and .g2aignore.",
    parameters: {
      type: "object",
      properties: {
        subDir: { type: "string", description: "Subdirectory relative to workspace root" },
        maxDepth: { type: "integer", description: "Maximum directory depth (default: 3)" },
      },
      additionalProperties: false,
    },
  },
  read_file: {
    name: "read_file",
    description: "Read content from a workspace file with line slicing. Sensitive files (.env, keys) are strictly blocked.",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Relative path to file within workspace" },
        startLine: { type: "integer", description: "First line to read (1-indexed)" },
        endLine: { type: "integer", description: "Last line to read (inclusive)" },
      },
      required: ["filePath"],
      additionalProperties: false,
    },
  },
  search_workspace: {
    name: "search_workspace",
    description: "Search workspace text or regex with file type filtering.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query or regex" },
        filePattern: { type: "string", description: "Glob pattern for files to include" },
        caseSensitive: { type: "boolean", description: "Case-sensitive search (default: false)" },
        maxResults: { type: "integer", description: "Maximum matches to return (default: 50)" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  git_status: {
    name: "git_status",
    description: "Get current git status of the workspace (staged, unstaged, untracked files).",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  git_diff: {
    name: "git_diff",
    description: "Inspect git diff for uncommitted changes (staged or unstaged).",
    parameters: {
      type: "object",
      properties: {
        staged: { type: "boolean", description: "Inspect staged diff only" },
        file: { type: "string", description: "Inspect diff for a specific relative file path" },
      },
      additionalProperties: false,
    },
  },
  test_status: {
    name: "test_status",
    description: "Get test execution results and output from the most recent test run.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  execution_summary: {
    name: "execution_summary",
    description: "Get an overview summary of Antigravity's current/recent execution session.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  execution_output: {
    name: "execution_output",
    description: "Inspect the detailed stdout/stderr and exit codes from commands executed by Antigravity.",
    parameters: {
      type: "object",
      properties: {
        commandIndex: { type: "integer", description: "Index of the command to inspect" },
      },
      additionalProperties: false,
    },
  },
  gemini_plan: {
    name: "gemini_plan",
    description: "Request Gemini Deep Thinking to analyze a task and generate a structured, phased implementation plan. By default, returns a zero-token pointer ticket (<50 tokens) to protect Antigravity's context limits.",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "The user task or feature description to plan for" },
        additionalContext: { type: "string", description: "Additional architectural guidelines, technical constraints, or preferences" },
        returnMode: {
          type: "string",
          enum: ["pointer", "compact", "full"],
          description: "Return format: 'pointer' (<50 tokens ticket, default for zero context bloat), 'compact' (~75% reduction checklist), or 'full'",
        },
      },
      required: ["task"],
      additionalProperties: false,
    },
  },
  gemini_get_phase: {
    name: "gemini_get_phase",
    description: "Fetch a specific phase from the active plan on-demand (Just-In-Time Phase Delivery). Uses minimal tokens (~80 tokens) to keep Antigravity context clean.",
    parameters: {
      type: "object",
      properties: {
        phaseIndex: { type: "integer", description: "The 1-based index of the phase to retrieve (e.g. 1, 2, 3)" },
        planId: { type: "string", description: "Optional specific plan ID. If omitted, uses active plan." },
      },
      required: ["phaseIndex"],
      additionalProperties: false,
    },
  },
  gemini_active_plan: {
    name: "gemini_active_plan",
    description: "Inspect current active plan metadata, audit score, phases list, and disk artifact path with near-zero Antigravity token usage.",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["ticket", "summary", "full"],
          description: "Return mode: 'ticket' (<50 tokens), 'summary' (~200 tokens), or 'full'",
        },
      },
      additionalProperties: false,
    },
  },
  gemini_review: {
    name: "gemini_review",
    description: "Request Gemini to perform an adversarial code review of the current git diff and test results against quality, security, and regression checklists.",
    parameters: {
      type: "object",
      properties: {
        taskDescription: { type: "string", description: "Description of what this change was intended to accomplish" },
        file: { type: "string", description: "Optional specific file to restrict the diff review to" },
      },
      required: ["taskDescription"],
      additionalProperties: false,
    },
  },
  gemini_think: {
    name: "gemini_think",
    description: "Ask Google Gemini Thinking model to reason deeply about a difficult bug, architectural design question, or system tradeoff.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The complex question, bug symptom, or architectural tradeoff to think about" },
        context: { type: "string", description: "Relevant context, error logs, or code snippets" },
        thinkingBudget: { type: "integer", description: "Reasoning token budget (default 8192)" },
      },
      required: ["question"],
      additionalProperties: false,
    },
  },
  gemini_validate_plan: {
    name: "gemini_validate_plan",
    description: "Validate an implementation plan against the RULES.MD technical governance framework (Non-Goals >= 3, AS-IS Evidence, Single DRI, PERT math, RAID log, Halt-on-Unknown).",
    parameters: {
      type: "object",
      properties: {
        planMarkdown: { type: "string", description: "Markdown content of plan to validate. If omitted, validates active plan." },
        planId: { type: "string", description: "Optional specific plan ID to validate from history" },
      },
      additionalProperties: false,
    },
  },
  gemini_calculate_pert: {
    name: "gemini_calculate_pert",
    description: "Calculate statistical PERT estimate (Expected Hours E and Standard Deviation Sigma) using formula E = (O + 4M + P) / 6 and Sigma = (P - O) / 6.",
    parameters: {
      type: "object",
      properties: {
        optimistic: { type: "number", description: "Optimistic duration in hours (O)" },
        mostLikely: { type: "number", description: "Most likely duration in hours (M)" },
        pessimistic: { type: "number", description: "Pessimistic duration in hours (P)" },
      },
      required: ["optimistic", "mostLikely", "pessimistic"],
      additionalProperties: false,
    },
  },
  gemini_list_models: {
    name: "gemini_list_models",
    description: "List all discovered modern Gemini models (> 3.0), their tiers, and cooldown/throttle status. Confirms all legacy models <= 3.0 are discarded.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  gemini_refresh_models: {
    name: "gemini_refresh_models",
    description: "Force a live auto-discovery refresh from Google GenAI API to discover newly released models and update the local registry.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
};

export const MCP_INSTRUCTIONS = `Antigravity with Gemini (G2A) MCP Server.
Gemini acts as the planning and thinking brain, while Antigravity acts as the execution harness.
All plans strictly adhere to the RULES.MD Technical Governance Framework.
The system automatically discovers modern Gemini models (> 3.0) and discards legacy models (<= 3.0).
Use gemini_plan to formulate structured, phased plans. It returns a lightweight zero-token pointer ticket (<50 tokens).
Use gemini_get_phase(phaseIndex) to fetch tasks JIT on-demand when starting each phase to protect Antigravity's context window.
Use gemini_active_plan to inspect the active plan's progress and file artifact on disk.
Use gemini_validate_plan to verify plan compliance against RULES.MD axioms (Non-Goals >= 3, AS-IS Grounding, Single DRI, PERT math).
Use gemini_calculate_pert to compute statistical estimates (E and Sigma).
Use gemini_list_models to inspect active modern models (> 3.0) and cooldown states.
Use gemini_refresh_models to trigger live discovery of new models from Google API.
Use gemini_review to perform independent adversarial code reviews on git diffs.
Use gemini_think to reason about architectural dilemmas, complex bugs, or tradeoffs.
Use workspace inspection tools (workspace_info, list_directory, read_file, search_workspace, git_status, git_diff) for safe, read-only context retrieval.`;

export function writeAntigravityMcpSchemas(targetDir?: string): string[] {
  const dir = targetDir || path.join(getAntigravityMcpDirectory(), "antigravity-with-gemini");
  fs.mkdirSync(dir, { recursive: true });

  const writtenFiles: string[] = [];

  for (const [toolName, schema] of Object.entries(TOOL_SCHEMAS)) {
    const filePath = path.join(dir, `${toolName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(schema, null, 2), "utf-8");
    writtenFiles.push(filePath);
  }

  const instructionsPath = path.join(dir, "instructions.md");
  fs.writeFileSync(instructionsPath, MCP_INSTRUCTIONS, "utf-8");
  writtenFiles.push(instructionsPath);

  return writtenFiles;
}
