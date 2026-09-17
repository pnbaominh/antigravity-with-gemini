---
name: antigravity-with-gemini
description: >
  Gemini thinks. Antigravity works. Use Google Gemini as the planning, reasoning,
  and reviewing brain for Antigravity coding sessions, while Antigravity keeps full
  execution ownership (editing, shell, git, tests).
---

# Antigravity with Gemini (G2A)

> **Gemini thinks. Antigravity works.**  
> Gemini phụ trách suy nghĩ & lập kế hoạch. Antigravity phụ trách thực thi mã nguồn.

Antigravity owns execution: code editing, terminal commands, running test suites, git commits, and recovery.  
Gemini owns reasoning: codebase understanding, architectural breakdown, edge-case anticipation, and adversarial code reviews.  
The G2A Bridge provides Gemini with read-only MCP access to the local workspace, so control messages stay tiny (< 1 KB) and repositories are never uploaded wholesale.

---

## ⚡ Golden Rules

1. **NEVER paste entire files, massive diffs, or logs into Gemini.** Gemini reads them on demand through MCP tools (`read_file`, `git_diff`, `execution_output`).
2. **Strictly Read-Only MCP Boundary:** The G2A bridge server contains zero mutation/write tools. It is architecturally impossible for any prompt injection to modify or delete files.
3. **Control Messages Stay Small (< 1 KB):** Communication follows the structured `[G2A]` lifecycle.
4. **Adversarial Independent Review:** Antigravity never self-certifies. After code execution, Gemini independently inspects `git_diff` and `test_status` before giving the final sign-off.

---

## 🔄 The Collaborative Loop: [G2A]

```
             ┌──────────────────────────────────────────────┐
             │                Google Gemini                 │
             │       Planning • Reasoning • Review          │
             └──────────────┬──────────────────▲────────────┘
                            │                  │
           MCP (Read-Only)  │                  │ Control Protocol
           Data Plane       │                  │ [G2A] Messages (< 1 KB)
                            ▼                  │
             ┌─────────────────────────────────┴────────────┐
             │                  G2A Bridge                  │
             │   9 Read-Only Tools (safe path, no writes)   │
             └──────────────┬───────────────────────────────┘
                            │
                            ▼
             ┌──────────────────────────────┐
             │       Local Workspace        │
             │    (Code, Git, Test Logs)    │
             └──────────────▲───────────────┘
                            │ Read / Write / Shell
             ┌──────────────┴───────────────┐
             │      Antigravity Harness     │
             │   File Editing • Shell • Git │
             └──────────────────────────────┘
```

### Stage 1: Initial Handshake (`[G2A] INIT`)
Antigravity verifies the G2A bridge is active:
```bash
g2a status
```
If stopped, Antigravity launches it:
```bash
g2a start
```

### Stage 2: Planning (`[G2A] PLAN`)
For complex features, refactors, or bugs, Antigravity delegates planning to Gemini:
```bash
g2a plan "<User Task Description>"
```
Or via MCP tool `gemini_plan(task, context)`.  
Gemini uses its deep reasoning tokens and inspects files through `read_file` / `search_workspace` to formulate a phased checklist with concrete verification steps.

### Stage 3: Phased Execution (`[G2A] EXECUTE`)
Antigravity executes each phase sequentially:
- Creates and edits files using exact line replacements.
- Runs build commands and test suites.
- Records test runs and command output automatically.

### Stage 4: Adversarial Code Review (`[G2A] REVIEW`)
Before presenting results to the user, Antigravity triggers Gemini to review the real changes:
```bash
g2a review "<Task Description>"
```
Or via MCP tool `gemini_review(taskDescription)`.  
Gemini pulls the actual `git_diff` and `test_status` via MCP and checks against:
- OWASP Top 10 vulnerabilities & secret leaks.
- Logic bugs & unhandled edge cases.
- Regressions & test coverage.

If `CHANGES_REQUESTED`: Antigravity addresses the findings and re-tests.  
If `APPROVED`: Proceed to Stage 5.

### Stage 5: Completion (`[G2A] DONE`)
Antigravity summarizes accomplishments in `walkthrough.md` and reports back to the user with full verification proof.

---

## 🛠️ CLI Quick Reference

```bash
g2a setup           # Install skill, run doctor checks, generate initial pairing code
g2a start           # Start the bridge daemon in background
g2a stop            # Stop the bridge daemon
g2a status          # Check bridge health, port, and tunnel status
g2a doctor          # Run environment and permission diagnostics
g2a pair            # Generate a new 6-digit one-time pairing code
g2a plan "<task>"   # Request a deep thinking plan from Gemini
g2a review          # Request an adversarial review of current git diff
g2a tunnel          # Launch a Cloudflare public quick tunnel
```
