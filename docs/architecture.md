# System Architecture: Antigravity with Gemini (G2A)

> **"Gemini thinks. Antigravity works."**

## High-Level Overview

G2A bridges the deep reasoning and massive context window of Google Gemini with the high-performance coding execution harness of Antigravity.

```
┌────────────────────────────────────────────────────────────────────────┐
│                             GOOGLE GEMINI                              │
│         Gemini 2.5 Pro / Gemini 2.5 Flash Thinking / Gemini CLI        │
│                                                                        │
│   • Multi-step Reasoning Tokens (Thinking Budget up to 8192)           │
│   • 1M - 2M Context Window                                             │
│   • Phased Implementation Roadmaps                                     │
│   • Adversarial Code & Security Review                                 │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                         Read-Only  │ Control Plane
                         Data Plane │ Protocol [G2A] (< 1 KB)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                              G2A BRIDGE                                │
│                                                                        │
│   • Loopback HTTP/SSE Transport (Port 4140+)                           │
│   • OAuth 2.1 PKCE Authorization Server                                │
│   • CSPRNG 6-Digit One-Time Pairing Code                               │
│   • Realpath Symlink & Traversal Blocker                               │
│   • Secret Masking Guard (.env*, private keys)                         │
│   • Cloudflare Quick Tunnel Integration                                │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Safe Read-Only
                                    ▼
┌───────────────────────────────────────────┐  ┌─────────────────────────┐
│              LOCAL WORKSPACE              │  │   ANTIGRAVITY HARNESS   │
│                                           │  │                         │
│  • Source Code & Documentation            │◀─┤  • Exact File Edits     │
│  • Git Repository (Diffs, Status, Logs)   │  │  • Shell Execution      │
│  • Test Output & Build Artifacts          │  │  • Automated Test Runs  │
│  • Execution Records (`latest_execution`) │  │  • Error Recovery       │
└───────────────────────────────────────────┘  └─────────────────────────┘
```

## Core Components

### 1. Data Plane (Read-Only MCP Server)
Exposes 9 standard Model Context Protocol tools to allow Gemini to inspect the workspace on demand:
- `workspace_info`: Detects package manager, frameworks, git branch, file counts.
- `list_directory`: Traverses project directories adhering strictly to `.gitignore` and `.g2aignore`.
- `read_file`: Reads specific line slices. Guaranteed safe by `resolveSafePath`.
- `search_workspace`: Sub-millisecond text and regex search avoiding binary and ignored paths.
- `git_status`: Porcelain status parser.
- `git_diff`: Working copy or staged diffs for code reviews.
- `test_status`: Reads outcome and failure logs of recent test executions.
- `execution_summary`: High-level summary of Antigravity's current task session.
- `execution_output`: Detailed stdout, stderr, and exit codes for individual commands.

### 2. Thinking Provider (In-Harness MCP Tools)
Provides Antigravity with direct tools to query Gemini's reasoning models:
- `gemini_plan`: Breaks down an underspecified prompt into atomic phases and verification targets.
- `gemini_review`: Performs an adversarial diff review checking for edge cases, memory leaks, security hazards, and code smells.
- `gemini_think`: General deep-thinking tool for root-cause diagnosis.

### 3. Security Boundary
- **Zero-Write Guarantee**: The MCP server does not implement any modification, writing, shell, or deletion tools.
- **Path Confinement**: All file queries are resolved via `fs.realpathSync`. Any path containing `..` or leading outside the workspace root raises `SecurityError`.
- **Secret Protection**: File names matching `.env*` (except `.env.example`), private keys (`id_rsa`, `.pem`, `.key`), and git credentials cannot be read under any circumstances.
