# Architecture Specification: Antigravity with Gemini (G2A)

> **"Gemini thinks. Antigravity works."**  
> G2A decouples architectural planning, deep reasoning, and adversarial code review from low-level execution, giving AI coding agents massive context advantages while preventing context bloat and token exhaustion.

---

## 1. System Overview & Core Philosophy

In traditional AI coding workflows, a single LLM is burdened with reading thousands of lines of workspace code, synthesizing implementation plans, generating code patches, running shell commands, parsing test logs, and self-reviewing. This causes:
1. **Context Window Exhaustion**: Rapid context pollution leading to degraded reasoning, hallucinations, and early context truncation.
2. **Execution Traps**: Without pre-planning and pre-mortem risk audits, agents rush into premature edits, hitting platform incompatibilities (CRLF vs LF, Windows paths vs POSIX, race conditions).
3. **High Token Costs & Sluggish Response**: Reloading entire project histories on every turn.

**Antigravity with Gemini (G2A)** resolves this by enforcing a strict separation of concerns:
- **Google Gemini (Thinking Brain)**: Possesses a 1M–2M context window and dedicated Deep Thinking reasoning budgets (up to 8,192 tokens). Gemini inspects workspace metadata, formulates hardened technical blueprints adhering to the `RULES.MD` Technical Governance Framework, and conducts adversarial code reviews.
- **Antigravity Harness (Execution Body)**: Owns local disk writes, AST code refactoring, terminal shell execution, automated test runs, and git workflows.
- **G2A Model Context Protocol (MCP) Bridge**: The secure communication bus exposing 18 specialized tools between Gemini and Antigravity.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             GOOGLE GEMINI THINKING                               │
│              Gemini Web (3.8 Flash / 3.1 Pro)  OR  Google GenAI SDK               │
│                                                                                  │
│   • Deep Thinking Reasoning (up to 8,192 tokens)                                 │
│   • 1M - 2M Massive Working Memory                                               │
│   • Pre-Planning Reconnaissance & RULES.MD Architecture                          │
│   • In-Thread Single-Chat Refinement Loop (continueConversation: true)          │
│   • Adversarial Diff & Security Review                                           │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
                 JSON-RPC 2.0 via Stdio  │  or SSE / Loopback HTTP (OAuth 2.1 PKCE)
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         ANTIGRAVITY-WITH-GEMINI BRIDGE                           │
│                                                                                  │
│  ┌───────────────────────────────┐     ┌──────────────────────────────────────┐  │
│  │   Gemini Web Client Engine    │     │      Dynamic Model Registry          │  │
│  │  • Playwright Persistent Ctx  │     │  • Auto-detect modern models (> 3.0) │  │
│  │  • Profile: ~/.g2a/browser    │     │  • Prioritize 3.8 Flash > 3.1 Pro    │  │
│  │  • Material Overlay Selector  │     │  • Quota-aware cooldown management   │  │
│  │  • 4-Tier Autonomous Bypass   │     │  • Legacy model discard (<= 3.0)     │  │
│  └───────────────────────────────┘     └──────────────────────────────────────┘  │
│                                                                                  │
│  ┌───────────────────────────────┐     ┌──────────────────────────────────────┐  │
│  │   RULES.MD Governance Engine  │     │      Token Boundary Guardian         │  │
│  │  • 5 Fundamental Axioms       │     │  • Zero-Token Pointer Tickets (<50t) │  │
│  │  • 6-Section Invariant Parser │     │  • Just-In-Time (JIT) Phase Delivery │  │
│  │  • PERT Statistical Estimator │     │  • Compact Markdown (~75% reduction) │  │
│  │  • Pre-Mortem RAID Validator  │     │  • Full Artifact Disk Persistence    │  │
│  └───────────────────────────────┘     └──────────────────────────────────────┘  │
│                                                                                  │
│  ┌───────────────────────────────┐     ┌──────────────────────────────────────┐  │
│  │    9 Workspace Read Tools     │     │      9 Thinking & Governance Tools   │  │
│  │  • workspace_info             │     │  • gemini_plan                       │  │
│  │  • list_directory             │     │  • gemini_get_phase (JIT)            │  │
│  │  • read_file (slice-safe)     │     │  • gemini_active_plan                │  │
│  │  • search_workspace           │     │  • gemini_review                     │  │
│  │  • git_status                 │     │  • gemini_think                      │  │
│  │  • git_diff                   │     │  • gemini_validate_plan              │  │
│  │  • test_status                │     │  • gemini_calculate_pert             │  │
│  │  • execution_summary          │     │  • gemini_list_models                │  │
│  │  • execution_output           │     │  • gemini_refresh_models             │  │
│  └───────────────────────────────┘     └──────────────────────────────────────┘  │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
                     Read-Only Inspection│ (Strict Zero-Write Boundary)
                                         ▼
┌──────────────────────────────────────────────────┐  ┌────────────────────────────┐
│                 LOCAL WORKSPACE                  │  │    ANTIGRAVITY HARNESS     │
│                                                  │  │                            │
│  • Source Code & Documentation                   │◀─┤  • Exact Code Edits        │
│  • Git Repository (Diffs, Status, Branches)      │  │  • Terminal Shell Commands │
│  • Automated Test Runners (Vitest, Jest, etc.)   │  │  • Verification Execution  │
│  • Plan Artifacts (.g2a/plans/*.md)              │  │  • Phase-by-Phase Rollout  │
│  • Execution Records (.g2a/latest_execution.json)│  │  • Artifact & Walkthrough  │
└──────────────────────────────────────────────────┘  └────────────────────────────┘
```

---

## 2. Dual-Engine Gemini Integration

G2A supports two complementary engines to connect with Gemini:

### Engine A: Autonomous Gemini Web Client (`GeminiWebClient`)
- **Default Engine**: Runs automatically when `GEMINI_ENGINE=web` (default) or when no API key is provided.
- **Quota Bypass**: Leverages the user's active Google account session on `gemini.google.com`, bypassing Google AI Studio rate limits (`RESOURCE_EXHAUSTED` / 429 errors).
- **Headless & Headed Browser Control**: Powered by Playwright using existing Chromium-based browsers (Brave, Google Chrome, Microsoft Edge).
- **Persistent Profile Directory**: Stores browser cookies, local storage, and authentication tokens in `~/.g2a/browser_profile` so login is only required once via `g2a login-web`.
- **Material Overlay Model Switching**: Automatically focuses the editor, opens the Angular Material model picker, and selects `3.8 Flash` via `[role="menuitem"]:has-text("3.8 Flash")`.
- **Single-Thread Multi-Turn Continuity**: Implements `continueConversation: boolean`. When refining plans, it sends follow-up prompts into the **exact same chat thread** without reloading or clicking "New chat", preserving Gemini's active thinking field and context.
- **4-Tier Autonomous Bypass**: Automatically mitigates refusal traps or conversational glitches through structured prompt inversion across tiers (Natural Directive -> Structural Schema -> Task Reframing -> Fallback model).

### Engine B: Google GenAI Studio API (`GeminiThinkingClient`)
- **API Engine**: Activated when `GEMINI_ENGINE=api` and a valid `GEMINI_API_KEY` is provided.
- **SDK**: Built on the official `@google/genai` SDK.
- **Customizable Thinking Budget**: Configures reasoning token limits (e.g. 4096 or 8192 tokens) for complex problem solving.
- **Dynamic Model Failover**: Automatically falls back to secondary candidate models if rate limits or capacity constraints are encountered.

---

## 3. Token Boundary Isolation & JIT Phase Architecture

To prevent Antigravity's context window from being flooded by large 500-line architecture plans, G2A implements the **Zero-Token Pointer Pattern**:

```
                              gemini_plan(task)
                                     │
                                     ▼
                   Full Plan Generated under RULES.MD
                                     │
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
         Saved to Local Disk             Zero-Token Pointer Ticket
     .g2a/plans/{plan-id}.md                     (< 50 tokens)
                                                     │
                                                     ▼
                                          Antigravity Context
                                                     │
                                                     ▼
                                          Phase 1: JIT Retrieval
                                        gemini_get_phase(phase=1)
                                                     │
                                                     ▼
                                           Executes & Verifies
                                                     │
                                                     ▼
                                          Phase 2: JIT Retrieval
                                        gemini_get_phase(phase=2)
```

1. **Zero-Token Pointer Ticket (`returnMode: 'pointer'`)**: The default return format for `gemini_plan`. Contains only the plan ID, title, audit score, file URI, and high-level phase list (< 50 tokens).
2. **Compact Plan (`returnMode: 'compact'`)**: An abbreviated operational checklist providing ~75% token reduction while retaining essential tasks and verification commands.
3. **Full Plan (`returnMode: 'full'`)**: The complete architectural RFC for cases where the full text is explicitly requested.
4. **Just-In-Time (JIT) Delivery (`gemini_get_phase`)**: Antigravity queries only the specific phase it is currently executing. Once Phase 1 passes verification, Antigravity calls `gemini_get_phase(phase=2)`, ensuring old phase tasks are naturally evicted from short-term memory.

---

## 4. The 18 MCP Tools Catalog

The MCP server exposes 18 specialized tools organized into two distinct groups:

### Group A: Workspace Data Plane (9 Safe Read-Only Tools)
| Tool | Functionality | Safety Guarantee |
|---|---|---|
| `workspace_info` | Inspects package manager, detected frameworks, git branch, root path | Read-only |
| `list_directory` | Traverses directories respecting `.gitignore` and `.g2aignore` | Traversal-blocked |
| `read_file` | Slice-based line reader with range support | Secret-masked |
| `search_workspace` | Sub-millisecond text and regex code search | Skips binaries/ignored |
| `git_status` | Returns porcelain git working tree state | Read-only |
| `git_diff` | Working copy or staged diffs for reviews | Read-only |
| `test_status` | Summarizes recent automated test outcomes | Read-only |
| `execution_summary`| High-level summary of Antigravity's active execution | Read-only |
| `execution_output` | Detailed stdout, stderr, and exit codes of recent runs | Read-only |

### Group B: Thinking, Planning & Governance (9 Tools)
| Tool | Functionality | Primary Engine |
|---|---|---|
| `gemini_plan` | Generates a 6-section RULES.MD plan with pointer ticket | Gemini Web / API |
| `gemini_get_phase` | Fetches a single phase's tasks and verification command JIT | Local Plan Store |
| `gemini_active_plan`| Retrieves the current active plan ticket or phase summary | Local Plan Store |
| `gemini_review` | Conducts an adversarial code review on git diffs | Gemini Web / API |
| `gemini_think` | Deep architectural and root-cause reasoning tool | Gemini Web / API |
| `gemini_validate_plan`| Validates plan markdown against the 5 RULES.MD axioms | Local Rules Engine |
| `gemini_calculate_pert`| Calculates 3-point PERT expected duration and standard deviation | Local Rules Engine |
| `gemini_list_models` | Lists modern models (> 3.0), active default, and cooldowns | Dynamic Registry |
| `gemini_refresh_models`| Triggers live discovery of latest models from Google API | Dynamic Registry |

---

## 5. Security Architecture & Boundary Invariants

G2A enforces a multi-layered security model:

1. **Strict Zero-Write Invariant**: The MCP server contains zero write, delete, patch, or shell execution tools. Even if an adversary exploits a prompt injection vulnerability in Gemini, the bridge cannot mutate files or execute commands.
2. **Path Confinement (`resolveSafePath`)**: All workspace paths are resolved using `fs.realpathSync`. Any path containing `..` or resolving outside the workspace root triggers an immediate fatal `SecurityError`.
3. **Sensitive Data Masking**: Automated pattern matching blocks access to `.env*` (except `.env.example`), private keys (`id_rsa`, `id_ed25519`, `*.pem`, `*.key`), `.git/credentials`, and database connection strings.
4. **Prompt Sanitization (`PromptSanitizer`)**: Sanitizes incoming user tasks before passing them to LLM prompts, stripping adversarial prompt injection markers and bounding execution scope.
5. **OAuth 2.1 PKCE & CSPRNG Pairing**: For external HTTP/SSE transport modes, connections require an OAuth 2.1 PKCE authorization code exchange backed by a 6-digit CSPRNG one-time pairing code with a 5-minute TTL.

---

## 6. Directory & Storage Layout

When G2A operates in a workspace and user environment, it maintains the following structure:

```
~/.g2a/
├── browser_profile/         # Persistent Chromium profile (cookies, Google login session)
├── g2a.json                 # Global configuration (engine, preferred model, API keys)
└── logs/                    # Bridge daemon and MCP server logs

<workspaceRoot>/
├── .g2a/
│   ├── plans/               # Stored plan specifications ({plan-id}.md)
│   ├── history.json         # Plan index, audit scores, and active plan pointer
│   └── latest_execution.json# Recent command execution output for review tools
├── RULES.md                 # Workspace Technical Governance Framework
├── .g2aignore               # Custom ignore rules for directory traversal
└── .gitignore               # Standard Git ignore rules
```
