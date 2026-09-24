import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAntigravityMcpDirectory } from "../config/paths.js";

export const TOOL_SCHEMAS: Record<string, any> = {
  workspace_info: {
    name: "workspace_info",
    description: "Get high-level information about the current workspace (root path, git branch, package manager, detected frameworks).",
    parameters: {
      type: "object",
      properties: {
        workspacePath: { type: "string", description: "Target workspace root directory. If omitted, uses current workspace." },
      },
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
        workspacePath: { type: "string", description: "Target workspace root directory. If omitted, uses current workspace." },
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
        workspacePath: { type: "string", description: "Target workspace root directory. If omitted, uses current workspace." },
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
        workspacePath: { type: "string", description: "Target workspace root directory. If omitted, uses current workspace." },
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
      properties: {
        workspacePath: { type: "string", description: "Target workspace root directory. If omitted, uses current workspace." },
      },
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
        workspacePath: { type: "string", description: "Target workspace root directory. If omitted, uses current workspace." },
      },
      additionalProperties: false,
    },
  },
  test_status: {
    name: "test_status",
    description: "Get test execution results and output from the most recent test run.",
    parameters: {
      type: "object",
      properties: {
        workspacePath: { type: "string", description: "Target workspace root directory. If omitted, uses current workspace." },
      },
      additionalProperties: false,
    },
  },
  execution_summary: {
    name: "execution_summary",
    description: "Get an overview summary of Antigravity's current/recent execution session.",
    parameters: {
      type: "object",
      properties: {
        workspacePath: { type: "string", description: "Target workspace root directory. If omitted, uses current workspace." },
      },
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
        workspacePath: { type: "string", description: "Target workspace root directory. If omitted, uses current workspace." },
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
        workspacePath: { type: "string", description: "Target workspace root directory. If omitted, uses current workspace." },
        additionalContext: { type: "string", description: "Additional architectural guidelines, technical constraints, or preferences" },
        model: {
          type: "string",
          description: "Gemini model to use in Gemini Web (e.g. '3.8 Flash', '3.1 Pro', or '3.5 Flash-Lite'). Defaults to newest '3.8 Flash'.",
        },
        continueConversation: {
          type: "boolean",
          description: "If true, continue in active Gemini Web conversation thread without creating a new chat session",
        },
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
        workspacePath: { type: "string", description: "Target workspace root directory. If omitted, uses current workspace." },
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
        workspacePath: { type: "string", description: "Target workspace root directory. If omitted, uses current workspace." },
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
        workspacePath: { type: "string", description: "Target workspace root directory. If omitted, uses current workspace." },
        model: {
          type: "string",
          description: "Gemini model to use (default: '3.8 Flash', or '3.1 Pro', '3.5 Flash-Lite')",
        },
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
        model: {
          type: "string",
          description: "Gemini model to use (default: '3.8 Flash', or '3.1 Pro', '3.5 Flash-Lite')",
        },
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
        workspacePath: { type: "string", description: "Target workspace root directory. If omitted, uses current workspace." },
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

export const MCP_INSTRUCTIONS = `# Antigravity with Gemini (G2A) - MCP Operating Instructions

## Core Mandate: "Gemini Thinks. Antigravity Works."
Antigravity MUST NOT formulate ad-hoc implementation plans or conduct superficial self-reviews on complex engineering tasks. Whenever planning, architectural decisions, deep reasoning, or code reviews are required, Antigravity MUST leverage the specialized thinking tools provided by the \`antigravity-with-gemini\` MCP server.

---

## 1. Golden Rules of Operation

1. **Zero Context Bloat (Zero-Token Pointer Pattern)**:
   - When calling \`gemini_plan\`, the default \`returnMode\` is \`"pointer"\`.
   - The returned pointer ticket is extremely compact (< 50 tokens), containing only the plan ID, audit score, file artifact path, and high-level phase list.
   - The full, detailed plan specification is safely written to disk at \`.g2a/plans/{plan-id}.md\`.
   - NEVER request \`returnMode: "full"\` unless explicitly asked by the user, as this floods your context window with hundreds of lines of specification.

2. **Just-In-Time (JIT) Phase Delivery**:
   - Execute the plan phase-by-phase.
   - At the start of Phase 1, call \`gemini_get_phase(phaseIndex=1)\` to retrieve atomic tasks (\`[NEW]\`, \`[MODIFY]\`, \`[DELETE]\`), file paths, and the exact runnable shell verification command.
   - Execute the tasks, run the verification command, and verify that it passes.
   - Once Phase 1 is verified, call \`gemini_get_phase(phaseIndex=2)\`. This JIT approach guarantees zero context pollution.

3. **Modern Model Default (\`3.8 Flash\`)**:
   - The system automatically selects Google's newest reasoning model (\`3.8 Flash\`) as the default.
   - Legacy models (<= 3.0) are discarded by the Dynamic Model Registry.
   - If a specific model is needed, pass \`model: "3.8 Flash"\`, \`"3.1 Pro"\`, or \`"3.5 Flash-Lite"\`.

4. **Adversarial Code & Security Review**:
   - Upon completing implementation phases, do NOT declare completion without verification.
   - Call \`gemini_review({ taskDescription: "..." })\` to conduct an adversarial audit of the working copy git diff and test logs.
   - Address any \`CRITICAL\` or \`WARNING\` findings before finalizing.

5. **RULES.MD Technical Governance Invariants**:
   - All generated plans strictly adhere to the 6-section structure of \`RULES.md\`:
     1. AS-IS State & System Architecture Blueprint (Mermaid diagram + TypeScript interfaces)
     2. Non-Goals & Scope Boundaries (Mandatory >= 3)
     3. Unknowns & Halt Checks (Status: CLEAR or HALT)
     4. Risk Assessment & RAID Log (Mandatory >= 4 entries)
     5. Work Breakdown Structure (WBS) with atomic tags, single DRI, and PERT 3-point estimates: E = (O + 4M + P) / 6
     6. Definition of Done & Quality Gates (100% test pass, 0 type errors, clean build)

---

## 2. MCP Tools Quick Reference

### Planning & Reasoning
- \`gemini_plan\`: Generate a hardened architectural plan. Arguments: \`task\` (required), \`returnMode\` (\`"pointer"\`, \`"compact"\`, \`"full"\`), \`model\` (default \`"3.8 Flash"\`).
- \`gemini_get_phase\`: Fetch tasks and verification command for a single phase. Arguments: \`phaseIndex\` (required, 1-indexed).
- \`gemini_active_plan\`: Retrieve the current active plan ticket or progress summary.
- \`gemini_validate_plan\`: Programmatically validate a plan against the 5 RULES.MD axioms.
- \`gemini_calculate_pert\`: Calculate statistical PERT expected duration (E) and variance (Sigma).
- \`gemini_review\`: Perform adversarial code review on current git diff. Arguments: \`taskDescription\` (required), \`file\` (optional).
- \`gemini_think\`: Engage Gemini Deep Thinking for complex bugs or architectural tradeoffs. Arguments: \`question\` (required), \`context\` (optional), \`thinkingBudget\` (default 8,192).
- \`gemini_list_models\`: View active modern models and cooldown status.
- \`gemini_refresh_models\`: Trigger live discovery of new models from Google API.

### Safe Workspace Inspection
- \`workspace_info\`: Inspect package manager, frameworks, and active git branch.
- \`list_directory\`: Traverse directories respecting \`.gitignore\` and \`.g2aignore\`.
- \`read_file\`: Read line slices securely (path traversal and credentials strictly blocked).
- \`search_workspace\`: Sub-millisecond regex code search across the workspace.
- \`git_status\`: Get porcelain git status.
- \`git_diff\`: Inspect working copy or staged diffs.
- \`test_status\`: View outcome and failure logs of recent automated tests.
- \`execution_summary\`: High-level summary of Antigravity's active execution.
- \`execution_output\`: Stdout and stderr logs of recent command executions.`;

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

  // Copy complete docs suite into mcp directory if present
  try {
    const docsSource = path.resolve(fileURLToPath(new URL("../../docs", import.meta.url)));
    if (fs.existsSync(docsSource)) {
      const docsTarget = path.join(dir, "docs");
      fs.mkdirSync(docsTarget, { recursive: true });
      const entries = fs.readdirSync(docsSource);
      for (const entry of entries) {
        const srcFile = path.join(docsSource, entry);
        const stat = fs.statSync(srcFile);
        if (stat.isFile()) {
          const destFile = path.join(docsTarget, entry);
          fs.copyFileSync(srcFile, destFile);
          writtenFiles.push(destFile);
        }
      }
    }
  } catch {}

  return writtenFiles;
}
