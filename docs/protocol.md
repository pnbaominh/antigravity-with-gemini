# Protocol Specification: The [G2A] Autonomous Lifecycle

The G2A protocol establishes a deterministic, token-optimized collaboration loop between Google Gemini and the Antigravity execution harness.

---

## 1. Lifecycle State Machine

```
┌────────┐     ┌────────────────┐     ┌──────────────┐     ┌───────────────────────┐
│ [INIT] │ ──► │ [RECONNAISSANCE│ ──► │ [PLAN DRAFT] │ ──► │ [AUDIT & REFINE]      │
└────────┘     └────────────────┘     └──────────────┘     │ (In-Thread Continuity)│
                                                           └───────────┬───────────┘
                                                                       │
                                                                       ▼
┌────────┐     ┌────────────────────┐     ┌───────────────┐     ┌──────────────────┐
│ [DONE] │ ◄── │[ADVERSARIAL REVIEW]│ ◄── │ [JIT EXECUTE] │ ◄── │ [POINTER TICKET] │
└────────┘     │   (git_diff / test)│     │(gemini_get_ph)│     │  (< 50 tokens)   │
               └─────────┬──────────┘     └───────▲───────┘     └──────────────────┘
                         │                        │
                         └────── (Fix Cycle) ─────┘
```

---

## 2. Detailed Lifecycle Stages

### Stage 1: `[G2A] INIT` (Grounding & Discovery)
1. Antigravity or the user initiates a task session.
2. The bridge confirms that the MCP transport is active (Stdio transport for local harness, or SSE for remote).
3. The Dynamic Model Registry discovers available Gemini models, ensuring the newest model (`3.8 Flash`) is prioritized.
4. Grounding check: The workspace manager inspects the root path, package manager, and active Git branch.

### Stage 2: `[G2A] RECONNAISSANCE` (Deep Pre-Planning Investigation)
Before prompting Gemini to generate a plan, G2A runs an autonomous pre-planning reconnaissance pass (`investigatePrerequisites`):
- **Dependencies Analysis**: Inspects `package.json`, extracting core dependencies, devDependencies, and build/test scripts.
- **Config Scanner**: Discovers `tsconfig.json`, `vite.config.*`, `next.config.*`, `docker-compose.yml`, `Cargo.toml`, etc.
- **Source Layout Mapping**: Identifies top-level directories (`src/`, `tests/`, `components/`, `lib/`).
- **Technical Domain Profiling**: Categorizes the task (REST/GraphQL API, UI/Frontend state, Caching, DB, Security) and identifies platform traps (Windows CRLF vs POSIX LF, path normalization, concurrent locks).
- **Physical RULES.MD Injection**: Locates and reads the physical `RULES.md` file from disk, prepending its complete technical governance framework to the planning prompt.

### Stage 3: `[G2A] PLAN DRAFT` (Turn 1: Blueprint Generation)
1. The planning prompt is dispatched to Gemini (default model: `3.8 Flash`, reasoning budget: 4,096 tokens).
2. For Gemini Web Client, `continueConversation: false` ensures a fresh session is used.
3. Gemini acts as **Principal Software Architect** and outputs a pure technical Markdown document starting strictly with `# Plan: [Title]` covering all 6 mandatory sections of `RULES.MD`.

### Stage 4: `[G2A] AUDIT & IN-THREAD REFINEMENT` (Quality Gate)
1. **Deterministic Quality Audit**:
   - G2A's `RulesEngine` evaluates the draft plan against the 5 RULES.MD axioms.
   - Verifies: Title present, Non-Goals >= 3, Halt-on-Unknown check, RAID log >= 4 entries, WBS with atomic tags and runnable verification commands, PERT 3-point estimates, and binary Definition of Done.
2. **In-Thread Self-Correction Loop (`continueConversation: true`)**:
   - If the audit score is < 90 or any structural violation is found:
   - G2A dispatches a bilingual refinement prompt directly into the **exact same Gemini chat thread**.
   - **Crucial Rule**: The system **never** clicks "New chat" or reloads the page. This preserves Gemini's active thinking context and architectural memory.
   - Gemini outputs the fully refined, compliant plan.

### Stage 5: `[G2A] POINTER TICKET` (Token Boundary Protection)
1. The finalized plan is saved to disk at `.g2a/plans/{plan-id}.md`.
2. Plan metadata and audit scores are recorded in `.g2a/history.json`.
3. `gemini_plan` returns a **Zero-Token Pointer Ticket** (< 50 tokens) to Antigravity:
   ```markdown
   # 🎯 Active Plan: Distributed Redis Cache with Mutex
   - **Plan ID:** `plan-1710928341`
   - **File Artifact:** [plan-1710928341.md](file:///path/to/.g2a/plans/plan-1710928341.md)
   - **Audit Score:** 95/100 (APPROVED)
   - **Total Phases:** 4
   - **Governance:** VALID (0 violations)
   
   👉 Use `gemini_get_phase(phaseIndex=1)` to load the first phase.
   ```
4. Antigravity's context window remains completely clean.

### Stage 6: `[G2A] JIT EXECUTE` (Phase-by-Phase Rollout)
1. Antigravity calls `gemini_get_phase(phaseIndex=1)` to load the specific atomic tasks and runnable verification command for Phase 1.
2. Antigravity performs the file edits (`[NEW]`, `[MODIFY]`, `[DELETE]`).
3. Antigravity executes the phase's shell verification command (e.g. `npm.cmd test tests/cache.test.ts`).
4. Output and exit codes are recorded into `.g2a/latest_execution.json`.
5. Upon successful verification, Antigravity increments the phase index and calls `gemini_get_phase(phaseIndex=2)`.

### Stage 7: `[G2A] ADVERSARIAL REVIEW` (Code Quality & Security Gate)
1. Once all implementation phases are complete, Antigravity calls `gemini_review({ taskDescription: "..." })`.
2. Gemini reads `git_diff` and `test_status` through the read-only MCP data plane.
3. Gemini performs an adversarial audit checking:
   - Functional completeness against the authorized scope.
   - Security vulnerabilities (injection, hardcoded secrets, input sanitization).
   - Code hygiene, error handling, and potential regressions.
4. **Outcomes**:
   - `APPROVED`: Quality gate cleared.
   - `CHANGES_REQUESTED`: Contains concrete code recommendations. Antigravity returns to `[JIT EXECUTE]` to address the findings.

### Stage 8: `[G2A] DONE` (Final Verification)
1. Antigravity verifies all items in Section 6 (Definition of Done): 100% test pass, 0 type errors (`tsc --noEmit`), clean production build (`npm run build`).
2. Antigravity writes the `walkthrough.md` artifact and notifies the user.

---

## 3. Protocol Message Contracts

### JSON-RPC 2.0 over Stdio (Antigravity Harness Integration)
```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "tools/call",
  "params": {
    "name": "gemini_plan",
    "arguments": {
      "task": "Refactor authentication system to support OAuth 2.1 PKCE",
      "model": "3.8 Flash",
      "returnMode": "pointer"
    }
  }
}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# 🎯 Active Plan: OAuth 2.1 PKCE Refactoring\n- **Plan ID:** `plan-1710928341`\n- **File Artifact:** [plan-1710928341.md](file:///...)\n- **Audit Score:** 95/100 (APPROVED)\n..."
      }
    ]
  }
}
```
