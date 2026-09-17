# Antigravity with Gemini (`g2a`)

[English](README.md) | **[Tiếng Việt](README.vi.md)**

> **Gemini thinks. Antigravity works.**  
> Use Google Gemini as the planning, reasoning, and reviewing brain while keeping the Antigravity harness.

Inspired by [XiaoDuoYa/codex-with-chatgpt](https://github.com/XiaoDuoYa/codex-with-chatgpt), this project brings the same breakthrough architecture to **Google Gemini** and **Antigravity**:
- **Gemini** (with its 2M context window and Deep Thinking reasoning tokens) acts as the high-level planning and code-review brain.
- **Antigravity** acts as the high-performance agentic execution harness owning file editing, shell commands, test executions, and git operations.

---

## 🚀 Key Highlights

1. **Strictly Read-Only MCP Bridge**: The bridge provides Gemini with 9 secure read-only MCP tools to inspect workspace files, search code, and review git diffs on demand without uploading the entire codebase.
2. **Direct In-Harness Thinking**: Provides Antigravity with native MCP tools (`gemini_plan`, `gemini_review`, `gemini_think`) to leverage Gemini reasoning models on demand.
3. **Rock-Solid Security**:
   - Zero write/mutation tools on the bridge (immune to prompt injection file modifications).
   - Realpath resolution blocks path traversal and symlink escapes.
   - Secret filter protects `.env*`, SSH keys, and credentials.
   - OAuth 2.1 PKCE and 6-digit CSPRNG one-time pairing codes.
4. **Antigravity Skill Included**: Installs seamlessly into Antigravity's skill system to drive the autonomous `[G2A]` loop.

---

## 📦 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/pnbaominh/antigravity-with-gemini.git
cd antigravity-with-gemini

# Install dependencies and build
npm install
npm run build

# Link CLI globally (optional)
npm link
```

### Setup & First Run

```bash
# Initialize workspace, install Antigravity skill, and run diagnostics
node ./bin/g2a.js setup

# Start the bridge daemon in background
node ./bin/g2a.js start

# Check status
node ./bin/g2a.js status
```

---

## 🛠️ CLI Commands

| Command | Description |
|---|---|
| `g2a setup` | Initialize environment, install Antigravity skill, run health checks |
| `g2a start` | Start the G2A bridge daemon in background (or `-f` for foreground) |
| `g2a stop` | Stop the running bridge daemon |
| `g2a status` | Inspect bridge PID, active port, SSE endpoint, and tunnel state |
| `g2a doctor` | Comprehensive environment diagnostics (Node, Git, Cloudflared) |
| `g2a pair` | Generate a fresh 6-digit one-time pairing code |
| `g2a plan "<task>"` | Ask Gemini Thinking (Principal Architect mode) to create a phased implementation blueprint |
| `g2a web "<task>"` | Copy workspace context & prompt to clipboard and open Google Gemini Web (gemini.google.com) |
| `g2a review` | Ask Gemini to perform an adversarial review of current git diff |
| `g2a tunnel` | Start a public Cloudflare quick tunnel for remote connections |
| `g2a mcp` | Run G2A MCP server over Stdio for direct Antigravity harness integration |

---

## 🏛️ Principal Architect Planning Engine

When you run `g2a plan "<task>"` or call the MCP tool `gemini_plan`, Gemini (with 8,192 reasoning tokens) generates an elite blueprint strictly structured in 5 sections:
1. **Executive Summary & Architecture Strategy**: Architectural patterns, Option A vs Option B trade-offs, blast radius & impact analysis, and end-to-end data/state lifecycles.
2. **File-by-File Technical Specification**: Explicit file demarcation tags (`[NEW]`, `[MODIFY]`, `[DELETE]`, `[TEST]`) with exact types, exported signatures, and invariants.
3. **Deep Technical Traps, Edge Cases & Guardrails**: Concurrency/race conditions, 429/503 retry budgets, Windows vs POSIX quirks (CRLF, path separators, file locks), security boundary validation, and backward compatibility.
4. **Phased Implementation Plan**: Sequenced atomic phases with granular task checkboxes (`- [ ] Task N.X`) and concrete, executable verification commands (`**Verification:**`).
5. **Acceptance Criteria & Quality Gates**: Test suites, type safety checks, and zero-regression policies.

---

## 🧩 Read-Only MCP Tools

When Gemini connects via the G2A Bridge, it has access to 9 sandboxed tools:

1. `workspace_info` - Root path, package manager, detected frameworks, and git branch.
2. `list_directory` - Safe directory listing respecting `.gitignore` and `.g2aignore`.
3. `read_file` - Slice-based line reader with automatic sensitive file blocking.
4. `search_workspace` - Fast regex/text search across the codebase.
5. `git_status` - Working tree status (staged, unstaged, untracked).
6. `git_diff` - Staged and working copy diffs for review.
7. `test_status` - Test suite outcome and failure details.
8. `execution_summary` - Summary of Antigravity's current task session.
9. `execution_output` - Stdout and stderr logs of executed commands.

---

## 🧪 Testing

Run the full Vitest test suite:

```bash
npm test
```

Includes tests for:
- Path traversal and symlink escape defenses.
- Sensitive file blacklist enforcement.
- CSPRNG pairing code generation and expiration.
- OAuth 2.1 PKCE authorization and token exchange.
- MCP Server tool registration.

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
