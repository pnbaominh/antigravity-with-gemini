# MCP Tools Reference: Antigravity with Gemini (G2A)

This document provides a comprehensive reference for all **18 Model Context Protocol (MCP) tools** exposed by the G2A server.

---

## 1. Workspace Inspection Tools (Data Plane - Read-Only)

These 9 tools allow Gemini to inspect local project state securely without mutating files or executing arbitrary code.

### 1.1 `workspace_info`
- **Description**: Returns high-level metadata about the workspace (project name, package manager, detected frameworks, active git branch, root directory).
- **Parameters**:
  - `workspacePath` (optional, string): Custom workspace path. Defaults to active workspace.
- **Example Usage**:
  ```json
  { "name": "workspace_info", "arguments": {} }
  ```
- **Returns**: JSON object with `name`, `branch`, `packageManager`, `frameworks`, `root`.

---

### 1.2 `list_directory`
- **Description**: Lists directory contents respecting `.gitignore` and `.g2aignore`.
- **Parameters**:
  - `relativeDirectory` (optional, string): Subdirectory path relative to workspace root (e.g., `src/mcp`).
  - `maxDepth` (optional, number): Maximum traversal depth (default: 3).
  - `includeIgnored` (optional, boolean): Whether to bypass ignore filters (default: false).
  - `workspacePath` (optional, string): Target workspace root.
- **Example Usage**:
  ```json
  { "name": "list_directory", "arguments": { "relativeDirectory": "src/browser", "maxDepth": 2 } }
  ```

---

### 1.3 `read_file`
- **Description**: Reads content from a workspace file with line slice support. Traversal and credential files are strictly blocked.
- **Parameters**:
  - `filePath` (required, string): Relative path to file (e.g., `src/gemini/planner.ts`).
  - `startLine` (optional, number): 1-indexed starting line number.
  - `endLine` (optional, number): 1-indexed ending line number.
  - `workspacePath` (optional, string): Target workspace root.
- **Example Usage**:
  ```json
  { "name": "read_file", "arguments": { "filePath": "package.json", "startLine": 1, "endLine": 50 } }
  ```

---

### 1.4 `search_workspace`
- **Description**: Executes sub-millisecond text and regex searches across codebase files. Binary files and ignored paths are excluded.
- **Parameters**:
  - `query` (required, string): Search string or regex pattern.
  - `isRegex` (optional, boolean): Treat query as regex (default: false).
  - `includePattern` (optional, string): Glob pattern to filter files (e.g., `*.ts`).
  - `maxResults` (optional, number): Maximum matching results (default: 50).
  - `workspacePath` (optional, string): Target workspace root.
- **Example Usage**:
  ```json
  { "name": "search_workspace", "arguments": { "query": "ensureBestModel", "includePattern": "*.ts" } }
  ```

---

### 1.5 `git_status`
- **Description**: Returns porcelain git working tree status (staged, unstaged, untracked files).
- **Parameters**:
  - `workspacePath` (optional, string): Target workspace root.
- **Example Usage**:
  ```json
  { "name": "git_status", "arguments": {} }
  ```

---

### 1.6 `git_diff`
- **Description**: Returns working copy or staged diffs for code reviews.
- **Parameters**:
  - `staged` (optional, boolean): Review staged diffs only (default: false).
  - `file` (optional, string): Restrict diff to a specific file.
  - `workspacePath` (optional, string): Target workspace root.
- **Example Usage**:
  ```json
  { "name": "git_diff", "arguments": { "file": "src/browser/gemini-web-client.ts" } }
  ```

---

### 1.7 `test_status`
- **Description**: Reads the outcome and failure logs of recent automated test runs.
- **Parameters**:
  - `workspacePath` (optional, string): Target workspace root.
- **Returns**: Formatted summary of passed, failed, and skipped test suites.

---

### 1.8 `execution_summary`
- **Description**: Summarizes recent Antigravity execution records (command line, exit code, duration, status).
- **Parameters**:
  - `workspacePath` (optional, string): Target workspace root.

---

### 1.9 `execution_output`
- **Description**: Retrieves full stdout and stderr logs of recent command runs.
- **Parameters**:
  - `runId` (optional, string): Specific run identifier. Defaults to latest execution.
  - `workspacePath` (optional, string): Target workspace root.

---

## 2. Thinking, Planning & Governance Tools

These 9 tools empower Antigravity to harness Gemini's Deep Thinking models for architectural synthesis and adversarial review.

### 2.1 `gemini_plan`
- **Description**: Formulates a complete 6-section architectural plan under the `RULES.MD` Technical Governance Framework. By default, returns a **Zero-Token Pointer Ticket (< 50 tokens)** to keep Antigravity's context clean.
- **Parameters**:
  - `task` (required, string): The feature or refactoring description.
  - `returnMode` (optional, enum: `"pointer"` | `"compact"` | `"full"`): Format of returned plan. Default is `"pointer"`.
  - `model` (optional, string): Gemini model to use (default: `"3.8 Flash"`).
  - `additionalContext` (optional, string): Technical preferences or constraints.
  - `workspacePath` (optional, string): Target workspace root.
- **Example Usage**:
  ```json
  {
    "name": "gemini_plan",
    "arguments": {
      "task": "Build end-to-end WebSocket real-time collaboration engine",
      "returnMode": "pointer"
    }
  }
  ```

---

### 2.2 `gemini_get_phase`
- **Description**: Retrieves tasks, file tags (`[NEW]`, `[MODIFY]`), and runnable verification command for a single phase Just-In-Time (JIT).
- **Parameters**:
  - `phaseIndex` (required, number): 1-indexed phase number (e.g., `1`).
  - `planId` (optional, string): Specific plan ID. Defaults to active plan.
  - `workspacePath` (optional, string): Target workspace root.
- **Example Usage**:
  ```json
  { "name": "gemini_get_phase", "arguments": { "phaseIndex": 1 } }
  ```

---

### 2.3 `gemini_active_plan`
- **Description**: Returns the active plan pointer ticket, file URI, audit score, and phase list.
- **Parameters**:
  - `mode` (optional, enum: `"ticket"` | `"summary"` | `"full"`): Output detail level (default: `"ticket"`).
  - `workspacePath` (optional, string): Target workspace root.

---

### 2.4 `gemini_review`
- **Description**: Requests Gemini to conduct an adversarial code review of the current git diff and test output against security, logic, and regression checklists.
- **Parameters**:
  - `taskDescription` (required, string): Description of what the change was intended to accomplish.
  - `file` (optional, string): Restrict review to a specific file.
  - `model` (optional, string): Gemini model to use (default: `"3.8 Flash"`).
  - `workspacePath` (optional, string): Target workspace root.
- **Returns**: Structured review with `# Code Review Verdict: [APPROVED | CHANGES_REQUESTED]`, critique, and actionable findings (`CRITICAL`, `WARNING`, `SUGGESTION`).

---

### 2.5 `gemini_think`
- **Description**: Engages Gemini's Deep Thinking model to reason through complex bugs, concurrency hazards, or architectural dilemmas.
- **Parameters**:
  - `question` (required, string): The technical question, bug symptom, or tradeoff.
  - `context` (optional, string): Relevant stack traces, logs, or code snippets.
  - `thinkingBudget` (optional, number): Reasoning token budget (default: 8,192 tokens).
  - `model` (optional, string): Gemini model to use (default: `"3.8 Flash"`).

---

### 2.6 `gemini_validate_plan`
- **Description**: Validates an implementation plan against the `RULES.MD` Technical Governance Framework (verifies Non-Goals >= 3, RAID log >= 4, single DRI, PERT math, binary Definition of Done).
- **Parameters**:
  - `planMarkdown` (optional, string): Markdown plan to validate. Defaults to active plan on disk.
  - `workspacePath` (optional, string): Target workspace root.
- **Returns**: Validation verdict (`VALID` / `INVALID`), score (0–100), and list of violations.

---

### 2.7 `gemini_calculate_pert`
- **Description**: Calculates statistical PERT estimations for project phases:  
  Expected Duration: \(E = \frac{O + 4M + P}{6}\), Standard Deviation: \(\sigma = \frac{P - O}{6}\).
- **Parameters**:
  - `optimistic` (required, number): Optimistic duration in hours (\(O\)).
  - `mostLikely` (required, number): Most likely duration in hours (\(M\)).
  - `pessimistic` (required, number): Pessimistic duration in hours (\(P\)).
- **Returns**: Formatted PERT breakdown with \(E\) and \(\sigma\).

---

### 2.8 `gemini_list_models`
- **Description**: Lists all modern Gemini models (> 3.0) registered in the Dynamic Model Registry, including active default (`3.8 Flash`), capabilities, and rate-limit cooldown status.
- **Parameters**: None.

---

### 2.9 `gemini_refresh_models`
- **Description**: Triggers dynamic model discovery from the Google API to refresh available models and capability flags.
- **Parameters**: None.
