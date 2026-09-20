---
name: antigravity-with-gemini
description: >
  CRITICAL: Antigravity MUST NEVER formulate plans itself. ALWAYS call gemini_plan MCP tool.
  Gemini thinks. Antigravity works. Use Google Gemini as the planning, reasoning,
  and reviewing brain for Antigravity coding sessions, while Antigravity keeps full
  execution ownership (editing, shell, git, tests).
---

# Antigravity with Gemini (G2A)

> **Gemini thinks. Antigravity works.**  
> Gemini phụ trách suy nghĩ & lập kế hoạch. Antigravity phụ trách thực thi mã nguồn.

> [!CAUTION]
> ### 🛑 BẮT BUỘC: KHÔNG ĐƯỢC ĐỂ ANTIGRAVITY TỰ LẬP PLAN & CHỐNG ẢO GIÁC QUOTA
> - **KHÔNG CÓ QUOTA GOOGLE AI STUDIO**: G2A hoạt động **100% tự động qua phiên Gemini Web cục bộ (`gemini.google.com`)**. Hoàn toàn **KHÔNG CẦN API KEY** và **KHÔNG CÓ GIỚI HẠN QUOTA 20 REQ/NGÀY CỦA GOOGLE AI STUDIO**. Antigravity **TUYỆT ĐỐI KHÔNG ĐƯỢC NÓI / BÁO CÁO ẢO GIÁC** rằng "G2A tạm chạm giới hạn quota API 20 req/ngày của Google AI Studio"!
> - **TUYỆT ĐỐI CẤM ANTIGRAVITY TỰ LẬP PLAN (ZERO SELF-PLANNING BY ANTI)**: Khi người dùng yêu cầu lập kế hoạch hoặc gọi `/antigravity-with-gemini`, Antigravity **TUYỆT ĐỐI KHÔNG ĐƯỢC TỰ SUY NGHĨ / TỰ VIẾT PLAN** trong context của mình, và **KHÔNG ĐƯỢC TỰ TẠO `implementation_plan.md`** bằng token của Antigravity kể cả khi công cụ báo lỗi tạm thời!
> - **HÀNH ĐỘNG BẮT BUỘC**: Antigravity **PHẢI LUÔN LUÔN GỌI MCP TOOL** `gemini_plan` thông qua `call_mcp_tool(ServerName: "antigravity-with-gemini", ToolName: "gemini_plan", Arguments: { task: "..." })` (hoặc chạy lệnh CLI `g2a plan "<task>"`).
> - Nếu `gemini_plan` gặp lỗi tạm thời: Antigravity phải báo lỗi thực tế, hướng dẫn người dùng kiểm tra phiên đăng nhập trình duyệt bằng `g2a login-web`, và thực hiện lại lệnh `g2a plan "<task>"`. TUYỆT ĐỐI KHÔNG TỰ VIẾT PLAN THAY THẾ!
> - Gemini Web sẽ suy nghĩ và viết plan chuẩn RULES.MD lưu vào file đĩa `.g2a/plans/plan-<id>.md` và trả về một ticket pointer siêu nhẹ (< 50 tokens).
> - Antigravity chỉ nhận ticket, báo cho người dùng đường dẫn file plan trên đĩa, và dùng `gemini_get_phase(phaseIndex)` để lấy từng phase JIT khi thực thi, bảo đảm **0% context bloat** cho Antigravity.

Antigravity owns execution: code editing, terminal commands, running test suites, git commits, and recovery.  
Gemini owns reasoning: codebase understanding, architectural breakdown, edge-case anticipation, and adversarial code reviews.  
The G2A Bridge provides Gemini with read-only MCP access to the local workspace, so control messages stay tiny (< 1 KB) and repositories are never uploaded wholesale.

---

## ⚡ Golden Rules

1. **ANTIGRAVITY NEVER PLANS:** Planning belongs exclusively to Gemini via the `gemini_plan` tool. Antigravity is strictly forbidden from self-planning or polluting its own context window with massive plan text.
2. **NEVER paste entire files, massive diffs, or logs into Gemini.** Gemini reads them on demand through MCP tools (`read_file`, `git_diff`, `execution_output`).
3. **Strictly Read-Only MCP Boundary:** The G2A bridge server contains zero mutation/write tools. It is architecturally impossible for any prompt injection to modify or delete files.
4. **Control Messages Stay Small (< 1 KB):** Communication follows the structured `[G2A]` lifecycle.
5. **Adversarial Independent Review:** Antigravity never self-certifies. After code execution, Gemini independently inspects `git_diff` and `test_status` before giving the final sign-off.

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

### Stage 1: Native MCP Tool Calling (`[G2A] READY`)
G2A is natively registered in Antigravity (`mcp_config.json`) via Stdio transport.
**Antigravity does NOT need to run `g2a start` or start any background server.** The MCP tools (`gemini_plan`, `gemini_get_phase`, `gemini_review`, `gemini_think`) are available immediately in every workspace!

### Stage 2: Planning (`[G2A] PLAN`)
> [!IMPORTANT]
> **Antigravity MUST NEVER generate or write a plan itself.** All planning is 100% delegated to Gemini. Antigravity must never create an `implementation_plan.md` using its own model tokens. Antigravity MUST ALWAYS call the MCP tool:
> `call_mcp_tool(ServerName: "antigravity-with-gemini", ToolName: "gemini_plan", Arguments: { "task": "<User Task Description>", "workspacePath": "<Current Workspace Path>" })`
> Or from any terminal:
> `g2a plan "<User Task Description>"`

Gemini uses its deep reasoning tokens (8,192 thinking budget with models > 3.0) and acts as an elite **Principal Software Architect** to formulate a 6-section implementation blueprint according to `RULES.md`:
1. **Grounded Context & AS-IS State**: Concrete file paths, function signatures, error logs, and system metrics.
2. **Scope Boundaries**: Explicit In-Scope deliverables and at least 3 mandatory Non-Goals.
3. **RAID Log & Pre-Mortem**: Risks, Assumptions, Issues, and Dependencies with proactive mitigations.
4. **WBS & PERT Estimates**: Atomic work packages with expected duration $E$ and uncertainty $\sigma$, adhering to 8/80 hours rule.
5. **Acceptance Criteria & Quality Gates**: Binary Pass/Fail criteria and Definition of Done.
6. **Zero-Token Pointer Ticket**: Gemini writes the full plan to disk at `.g2a/plans/plan-<id>.md` and returns a lightweight ticket (<50 tokens) to Antigravity. Antigravity NEVER loads the full plan into its context; it only fetches tasks JIT per phase via `gemini_get_phase(phaseIndex)`.

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
g2a login-web       # Log in to Google Gemini Web (gemini.google.com) once and save persistent session
g2a start           # Start the bridge daemon in background
g2a stop            # Stop the bridge daemon
g2a status          # Check bridge health, port, and tunnel status
g2a doctor          # Run environment and permission diagnostics (verifies Brave/Edge/Chrome)
g2a pair            # Generate a new 6-digit one-time pairing code
g2a plan "<task>"   # Request a deep thinking plan via Gemini Web Engine (Principal Architect)
g2a web "<task>"    # Copy context & prompt and open Google Gemini Web manually if desired
g2a review          # Request an adversarial review of current git diff
g2a tunnel          # Launch a Cloudflare public quick tunnel
g2a mcp             # Run G2A MCP server over Stdio for direct Antigravity harness integration
```

