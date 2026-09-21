# Troubleshooting Guide: Antigravity with Gemini (G2A)

This document provides step-by-step diagnostic and resolution procedures for common operational scenarios.

---

## 1. System Health Diagnostic (`g2a doctor`)

Whenever you encounter unexpected behavior, run the automated health check first:

```bash
node ./bin/g2a.js doctor
```

This verifies:
- Node.js runtime version (>= 18.0.0 required)
- Git availability and working tree accessibility
- Chromium browser discovery (Brave, Google Chrome, Microsoft Edge)
- Browser profile directory (`~/.g2a/browser_profile`)
- MCP configuration (`~/.gemini/config/mcp_config.json`)
- Daemon status, lockfiles, and port availability

---

## 2. Gemini Web Client & Login Troubleshooting

### Symptom: `Google Gemini Web is not logged in. Please run g2a login-web`
- **Cause**: The persistent browser profile in `~/.g2a/browser_profile` does not contain an active Google authentication cookie.
- **Resolution**:
  1. Open a terminal and run the interactive login command:
     ```bash
     node ./bin/g2a.js login-web
     ```
  2. A browser window will open displaying the Google login page.
  3. Sign in to your Google Account (complete 2-Step Verification / 2FA if prompted).
  4. Once you land on `gemini.google.com/app`, the CLI will automatically detect the active session, flush cookies to disk, and display:
     ```
     ✓ Google login complete! Session verified and saved to .g2a/browser_profile.
     ```
  5. Close the browser window. Subsequent runs will execute autonomously in headless mode.

### Symptom: `Target page, context or browser has been closed` or Browser Lock Error
- **Cause**: Playwright's `launchPersistentContext` requires exclusive access to the browser user data directory (`~/.g2a/browser_profile`). If another Chromium process (or a zombie test script) is holding a lock on the directory, initialization fails.
- **Resolution**:
  - **Windows (PowerShell)**:
    ```powershell
    Get-Process -Name brave, chrome, msedge, node | Where-Object { $_.MainWindowTitle -eq "" } | Stop-Process -Force
    ```
  - **Linux / macOS**:
    ```bash
    pkill -f "browser_profile" || pkill -f "g2a"
    ```
  - Delete any stale lockfile in `~/.g2a/browser_profile/SingletonLock` or `~/.g2a/browser_profile/lockfile` if necessary.

---

## 3. Model Selector Troubleshooting (`3.8 Flash` vs `3.1 Pro`)

### Symptom: Gemini Web defaults to `3.1 Pro` or fails to switch to `3.8 Flash`
- **Background**:
  - Gemini Web uses an Angular Material overlay (`.cdk-overlay-container`) for its model dropdown.
  - The model selector button (`Mở công cụ chọn chế độ`) only renders in the DOM when the chat input textbox (`div[role="textbox"]`) has received focus.
  - In Vietnamese UI, the button text displays `"Flash\nMở rộng"` or `"Pro\nMở rộng"`.
- **Resolution**:
  1. Ensure you have the latest compiled build:
     ```bash
     npm run build
     ```
  2. Verify that `C:\Users\Bim\.gemini\config\mcp_config.json` includes:
     ```json
     "env": {
       "GEMINI_ENGINE": "web",
       "GEMINI_MODEL": "3.8 Flash"
     }
     ```
  3. Run the automated model switching verification script:
     ```bash
     node scratch/test-switch-38.mjs
     ```
     Expected output:
     ```
     VERIFIED: Successfully switched from 3.1 Pro to 3.8 Flash!
     ```

---

## 4. Stale In-Memory MCP Server Process

### Symptom: Changes to G2A code are ignored when called from Antigravity
- **Cause**: Antigravity runs the MCP server as a persistent background process (`node ... dist/cli/index.js mcp`). If you compile new code to `dist/`, Antigravity continues routing requests to the old in-memory process until it is killed.
- **Resolution**:
  1. Inspect running G2A processes:
     ```powershell
     Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*antigravity-with-gemini*" } | Select-Object ProcessId, CommandLine
     ```
  2. Kill the old background MCP process:
     ```powershell
     Stop-Process -Id <ProcessId> -Force
     ```
  3. On the next tool call (e.g. `gemini_plan`), Antigravity will automatically spawn a fresh process loading the updated `dist/` bundle.

---

## 5. Windows Shell & Execution Policy Quirks

### Symptom: `npm.ps1 cannot be loaded because running scripts is disabled on this system`
- **Cause**: Windows PowerShell default execution policy blocks unsigned `.ps1` scripts.
- **Resolution**:
  - Update execution policy for the current user:
    ```powershell
    Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
    ```
  - Alternatively, invoke `npm.cmd` or `node` explicitly:
    ```powershell
    npm.cmd run build
    node ./bin/g2a.js status
    ```

### Symptom: Line endings (CRLF vs LF) causing Git diff noise
- **Cause**: Windows Git defaults to CRLF line endings, which can create phantom diffs.
- **Resolution**:
  - Configure Git to handle line endings automatically:
    ```bash
    git config core.autocrlf true
    ```

---

## 6. Bridge Daemon & Port Conflicts

### Symptom: `Port 4140 is in use`
- **Resolution**:
  - G2A automatically hunts for the next available port (`4141`, `4142`...).
  - You can also specify an explicit port:
    ```bash
    node ./bin/g2a.js start --port 4200
    ```
  - To stop any running bridge daemon:
    ```bash
    node ./bin/g2a.js stop
    ```

### Symptom: `Pairing code expired or maximum attempts exceeded`
- **Cause**: Pairing codes expire after 5 minutes or 5 consecutive invalid entries.
- **Resolution**:
  - Generate a fresh 6-digit one-time code:
    ```bash
    node ./bin/g2a.js pair
    ```
