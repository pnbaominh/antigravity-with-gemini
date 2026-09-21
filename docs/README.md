# Antigravity with Gemini (G2A) - Technical Documentation

Welcome to the comprehensive technical documentation for **Antigravity with Gemini (G2A)**.

> **"Gemini thinks. Antigravity works."**  
> Decoupling architectural reasoning, deep planning, and adversarial code reviews from high-speed local code execution.

---

## 📚 Documentation Index

### 1. [System Architecture](architecture.md)
Detailed architectural overview of G2A:
- High-level design and dual-engine architecture (Gemini Web Client vs Google GenAI Studio API)
- The 18 Model Context Protocol (MCP) tools catalog
- Token boundary isolation and Zero-Token Pointer Tickets (< 50 tokens)
- Security invariants, realpath confinement, and secret shielding
- Filesystem and configuration directory layout

### 2. [The [G2A] Lifecycle Protocol](protocol.md)
The complete state machine governing autonomous agent operations:
- State transitions: `[INIT]` → `[RECONNAISSANCE]` → `[PLAN DRAFT]` → `[AUDIT & REFINE]` → `[POINTER TICKET]` → `[JIT EXECUTE]` → `[ADVERSARIAL REVIEW]` → `[DONE]`
- Deep pre-planning reconnaissance mechanics
- Single-thread multi-turn refinement loop (`continueConversation: true`)
- Just-In-Time (JIT) phase delivery protocol
- JSON-RPC 2.0 message contracts over Stdio and SSE

### 3. [MCP Tools Reference](mcp-tools.md)
Complete specification of all 18 MCP tools:
- **Group A (9 Workspace Read Tools)**: `workspace_info`, `list_directory`, `read_file`, `search_workspace`, `git_status`, `git_diff`, `test_status`, `execution_summary`, `execution_output`
- **Group B (9 Thinking & Governance Tools)**: `gemini_plan`, `gemini_get_phase`, `gemini_active_plan`, `gemini_review`, `gemini_think`, `gemini_validate_plan`, `gemini_calculate_pert`, `gemini_list_models`, `gemini_refresh_models`
- Parameter types, return schemas, error handling, and example payloads

### 4. [RULES.MD Technical Governance Framework](rules-governance.md)
The formal engineering standard for AI-generated plans:
- The 5 Fundamental Axioms (Grounding, Scope Boundaries, Single DRI, PERT Math, Binary DoD)
- The 6 Mandatory Sections of every architectural plan
- 3-point PERT estimation formula: \(E = (O + 4M + P) / 6\)
- Pre-Mortem Risk Assessment & RAID Log requirements
- Programmatic validation with `RulesEngine`

### 5. [Gemini Web Automation Engine](browser-engine.md)
Deep dive into the autonomous browser driver:
- Playwright persistent context management with `~/.g2a/browser_profile`
- Chromium browser auto-discovery (Brave, Chrome, Edge)
- Angular Material overlay model selector automation (guaranteeing `3.8 Flash`)
- Single-chat in-thread continuity without page reloads
- Quill rich-text Delta insertion and DOM stabilization
- 4-Tier Autonomous Bypass System

### 6. [Security & Threat Model](security.md)
Comprehensive threat analysis and defenses:
- Zero-write boundary preventing prompt injection file mutation
- Realpath symlink traversal blocking (`resolveSafePath`)
- Automated regex secret masking (`.env*`, private keys, cloud credentials)
- Task sanitization (`PromptSanitizer`)
- OAuth 2.1 PKCE authorization and CSPRNG 6-digit one-time pairing codes

### 7. [Troubleshooting Guide](troubleshooting.md)
Step-by-step diagnostic and recovery manual:
- Automated system check (`g2a doctor`)
- Interactive Google login (`g2a login-web`) and browser profile unlocking
- Model selector debugging and Angular Material overlay verification
- Terminating stale in-memory MCP server processes
- Windows PowerShell execution policies and line-ending quirks
- Port conflicts and Cloudflare quick tunnel recovery
