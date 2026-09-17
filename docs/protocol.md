# Protocol Specification: [G2A] Lifecycle

The G2A protocol establishes a structured, token-efficient control loop between Gemini and Antigravity.

## Lifecycle States

```
[INIT] ──► [PLAN] ──► [EXECUTE] ──► [REVIEW] ──► [DONE]
                         ▲              │
                         │ (Fixes)      │
                         └──────────────┘
```

### 1. `[G2A] INIT`
- Antigravity checks bridge daemon status via `g2a status`.
- If not running, launches with `g2a start`.
- Sends concise project metadata to Gemini.

### 2. `[G2A] PLAN`
- Triggered by `g2a plan "<Task>"` or tool call `gemini_plan`.
- Gemini pulls workspace info and directory tree via MCP.
- Gemini produces a structured phased plan with explicit verification steps.

### 3. `[G2A] EXECUTE`
- Antigravity takes the plan and executes phase by phase:
  - File creation and modifications.
  - Dependency installations.
  - Automated tests execution.
- Command outputs and test outcomes are automatically saved into `latest_execution.json`.

### 4. `[G2A] REVIEW`
- Antigravity invokes `g2a review` or tool call `gemini_review`.
- Gemini reads `git_diff` and `test_status` through MCP.
- If issues or edge cases are flagged:
  - Gemini outputs `CHANGES_REQUESTED` with specific code recommendations.
  - Antigravity returns to `EXECUTE` to address findings.
- If clean:
  - Gemini outputs `APPROVED`.

### 5. `[G2A] DONE`
- Antigravity completes work, updates walkthrough, and notifies the user.
