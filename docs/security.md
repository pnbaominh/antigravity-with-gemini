# Security & Threat Model: G2A

## Threat Analysis

### 1. Prompt Injection Attack
**Threat**: A malicious input or repo content instructs the planning LLM to overwrite or delete files.  
**Mitigation**: The G2A bridge data plane contains strictly 9 **read-only** tools. There is no write, delete, patch, or shell execution capability in the MCP server.

### 2. Path Traversal & Symlink Escape
**Threat**: An attacker tricks the tool into reading `/etc/passwd`, Windows registry keys, or parent directory secrets using `../../` or symlinks.  
**Mitigation**: `resolveSafePath` resolves paths using `fs.realpathSync` and computes relative distance to workspace root. Any path that resolves outside the root triggers a fatal `SecurityError`.

### 3. Secret Leakage
**Threat**: Reading `.env`, private SSH keys, or AWS/GCP service accounts into the model context.  
**Mitigation**: Automated regex filtering blocks `.env*` (except `.env.example`), `id_rsa`, `id_ed25519`, `*.pem`, `*.key`, and `.git/credentials`.

### 4. Unauthorized Access over Local Network or Tunnel
**Threat**: An unauthenticated third party connects to the local port or Cloudflare tunnel.  
**Mitigation**: 
- OAuth 2.1 with PKCE S256 challenge-verifier exchange.
- 6-digit CSPRNG one-time pairing code with a 5-minute TTL, expiring after a single successful exchange and locking out after 5 consecutive failures.
