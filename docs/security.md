# Security & Threat Model Specification: Antigravity with Gemini (G2A)

G2A is engineered with a defense-in-depth security model to ensure that pairing Google Gemini's massive reasoning capabilities with an autonomous coding harness does not introduce vulnerabilities into host developer systems.

---

## 1. Threat Analysis & Mitigation Matrix

| Threat Category | Attack Vector | Potential Impact | G2A Defense & Mitigation |
|---|---|---|---|
| **Prompt Injection** | Malicious content in repo (README, issue, git commit) instructing LLM to delete files or run malware | System compromise, data loss | **Zero-Write Invariant**: The MCP server exposes **strictly 0 write or shell tools**. All workspace tools are 100% read-only. |
| **Path Traversal** | Path arguments with `../../` or symbolic links pointing outside the workspace | Reading `/etc/passwd`, Windows registry, SSH keys | **Realpath Verification (`resolveSafePath`)**: Canonicalizes paths via `fs.realpathSync` and asserts boundary containment. |
| **Secret Exfiltration** | LLM attempting to inspect `.env`, AWS credentials, or private SSH keys | Leakage of API keys, credentials, or private keys | **Automated Secret Blocker**: Regex masking halts any attempt to read sensitive files or credential filenames. |
| **Unauthorized Access** | Remote attacker scanning port 4140 or sniffing Cloudflare quick tunnel | Unauthorized workspace inspection | **OAuth 2.1 PKCE + CSPRNG 6-digit one-time code**: Requires cryptographic proof and single-use pairing codes. |
| **Browser Hijacking** | Malicious websites or extensions interacting with the automation browser | Stealing Google login cookies or hijacking sessions | **Isolated User Profile**: Dedicated directory (`~/.g2a/browser_profile`) with `--disable-blink-features=AutomationControlled`. |

---

## 2. The 5 Security Layers in Detail

### Layer 1: The Zero-Write Architectural Boundary
The G2A Model Context Protocol server adheres to an immutable constraint: **Zero Modification Tools**.
- Under no circumstances does the MCP server expose `write_file`, `edit_file`, `delete_file`, `execute_command`, or `run_shell`.
- File creation and command execution are exclusively owned by the Antigravity harness running under explicit developer supervision.
- Even if a planning prompt is completely inverted by an adversarial injection in a malicious repository, Gemini cannot trigger destructive modifications through the MCP server.

### Layer 2: Realpath Path Traversal & Symlink Confinement
All file system operations (`read_file`, `list_directory`, `search_workspace`) pass through `resolveSafePath(workspaceRoot, requestedPath)`:
1. Resolves canonical filesystem paths using `fs.realpathSync`.
2. Resolves and dereferences all symbolic links.
3. Computes the relative path between `workspaceRoot` and the resolved target.
4. If the relative path begins with `..` or resolves to an external volume/drive, an explicit `SecurityError` is thrown:
   ```
   SecurityError: Path resolution escaped workspace boundary: "C:\Windows\System32"
   ```

### Layer 3: Automated Secret Masking & Sensitive File Shield
G2A intercepts all file read requests and blocks patterns matching sensitive credentials:
- **Environment Files**: Blocks `.env`, `.env.local`, `.env.production`, `.env.test` (allowing only `.env.example`).
- **Private Keys**: Blocks `id_rsa`, `id_ed25519`, `id_ecdsa`, `id_dsa`, `*.pem`, `*.key`, `*.p12`, `*.pfx`.
- **Git & Cloud Credentials**: Blocks `.git/credentials`, `.git/config`, `~/.aws/credentials`, `~/.gcloud`, `service-account*.json`.
- **Database Files**: Blocks `*.sqlite3-wal`, database dumps, and keychains.

Any read request targeting these files immediately returns:
```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "Access denied: Reading sensitive credential files is blocked by G2A security policy." }]
}
```

### Layer 4: Task Sanitization (`PromptSanitizer`)
When user requests are ingested for planning or adversarial review, `PromptSanitizer`:
- Scans for known prompt injection payloads (e.g., `Ignore previous instructions`, `DAN mode`, `System Override`).
- Enforces an authorized execution boundary, constraining the task to software engineering and architecture deliverables.
- Strips harmful shell escape characters and binary injection sequences.

### Layer 5: OAuth 2.1 PKCE & CSPRNG One-Time Pairing
When the G2A bridge daemon is accessed over loopback HTTP or a public Cloudflare tunnel:
- **PKCE S256**: All authorization flows require an ephemeral `code_verifier` and `code_challenge` generated using SHA-256.
- **CSPRNG 6-Digit Pairing Code**: Generated using `crypto.randomInt(100000, 999999)` with:
  - Strict 5-minute Time-To-Live (TTL).
  - Immediate invalidation upon first successful token exchange.
  - Automatic brute-force lockout: The daemon locks pairing after 5 consecutive failed attempts.
