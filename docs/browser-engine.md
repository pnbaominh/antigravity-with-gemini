# Gemini Web Automation Engine: Architecture & Operations

The **Gemini Web Client Engine (`GeminiWebClient`)** is a core component of G2A. It provides fully automated, headless or headed interaction with `gemini.google.com`, allowing Antigravity to utilize Google's newest reasoning models (such as `3.8 Flash` and `3.1 Pro`) using the developer's existing Google account, completely bypassing Google AI Studio API rate limits and quotas.

---

## 1. Architectural Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                          G2A APPLICATION LAYER                         │
│               (MCP Server / CLI / GeminiPlanner / GeminiReviewer)       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Generate Request (prompt, options)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        GEMINI WEB CLIENT ENGINE                        │
│                                                                        │
│  ┌─────────────────────────────┐    ┌───────────────────────────────┐  │
│  │   Browser Context Manager   │    │     Model Selector Engine     │  │
│  │  • Chromium auto-discovery  │    │  • Focus input toolbar        │  │
│  │  • ~/.g2a/browser_profile   │    │  • Angular Material overlay   │  │
│  │  • Cookie/Session retention │    │  • Selects 3.8 Flash directly │  │
│  └─────────────────────────────┘    └───────────────────────────────┘  │
│                                                                        │
│  ┌─────────────────────────────┐    ┌───────────────────────────────┐  │
│  │     Quill Textbox Driver    │    │   Single-Thread Continuity    │  │
│  │  • Native keyboard input    │    │  • continueConversation: true │  │
│  │  • Delta state preservation │    │  • Zero-reload context memory │  │
│  │  • Send button trigger      │    │  • In-thread plan refinement  │  │
│  └─────────────────────────────┘    └───────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │               4-Tier Autonomous Bypass Controller                │  │
│  │  Tier 1: Natural Directive  │  Tier 2: Structural Inversion      │  │
│  │  Tier 3: Model Alternate    │  Tier 4: Flash-Lite Fallback       │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ CDP / Playwright Driver
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                 HEADLESS / HEADED CHROMIUM INSTANCE                    │
│                 (Brave / Google Chrome / Microsoft Edge)               │
│                                                                        │
│           https://gemini.google.com/app (Google Account Session)       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Browser Discovery & Persistent Session Management

### Automatic Browser Discovery (`BrowserDetector`)
G2A scans common installation paths across Windows, macOS, and Linux to discover Chromium executables:
1. **Brave Browser** (default priority for anti-tracking and speed)
2. **Google Chrome**
3. **Microsoft Edge**
4. **Chromium**

### Session Persistence (`~/.g2a/browser_profile`)
Rather than starting an ephemeral incognito session that requires re-authenticating on every run, G2A launches via Playwright's `launchPersistentContext`:
- Storage path: `path.join(os.homedir(), ".g2a", "browser_profile")`
- Preserves cookies, local storage, indexedDB, and Google Account OAuth tokens.
- Authentication is performed once via `g2a login-web`.
- Stealth flags are passed to prevent bot detection:
  - `--disable-blink-features=AutomationControlled`
  - Strips `navigator.webdriver` via early init script.

---

## 3. Model Selector Automation: Guaranteeing `3.8 Flash`

Gemini Web employs an Angular Material UI with dynamic component rendering. G2A implements an infallible multi-step model switching sequence in `ensureBestModel`:

### Step 1: Input Field Focusing
On Gemini Web, the bottom toolbar containing the model selector button is conditionally rendered or unmounted until the chat input area is active. G2A explicitly focuses the textbox:
```typescript
const textbox = page.locator('div[role="textbox"].ql-editor, rich-textarea div[role="textbox"]').first();
if (await textbox.isVisible().catch(() => false)) {
  await textbox.click();
  await page.waitForTimeout(600);
}
```

### Step 2: Locating the Mode Selector Button
The button is identified across localization languages (English and Vietnamese):
- Vietnamese: `button[aria-label*="Mở công cụ chọn chế độ"]` or `button:has-text("Pro Mở rộng")` / `button:has-text("Flash Mở rộng")`.
- English: `button[aria-label*="Open model picker"]` or `button:has-text("3.8 Flash")` / `button:has-text("3.1 Pro")`.

### Step 3: Direct Menuitem Selection
When clicked, Angular Material renders a floating menu in the top-level `.cdk-overlay-container`.  
**Critical DOM Rule**: The parent container `<div class="mat-mdc-menu-content">` contains the text of all models. Clicking a container `div` dismisses the dropdown without selecting a model. G2A targets the exact menu item button directly:
```typescript
const targetItem = page.locator('[role="menuitem"]:has-text("3.8 Flash"), .mat-mdc-menu-item:has-text("3.8 Flash")').first();
if (await targetItem.isVisible({ timeout: 3000 })) {
  await targetItem.click({ force: true });
}
```

---

## 4. Single-Thread Multi-Turn Continuity (`continueConversation: true`)

When formulating complex implementation plans, a draft plan may require refinement (e.g. adding missing non-goals or completing PERT math).

Creating a new chat session destroys Gemini's thinking memory, requiring the entire workspace context to be re-uploaded. G2A solves this with **In-Thread Continuity**:
1. **Turn 1 (`continueConversation: false`)**:
   - Opens a fresh chat session.
   - Ensures `3.8 Flash` is active.
   - Submits the initial plan prompt.
2. **Turn 2 (`continueConversation: true`)**:
   - **No navigation**: Does NOT call `page.goto()` or reload.
   - **No session reset**: Does NOT click "Cuộc trò chuyện mới" / "New chat".
   - Inserts the refinement prompt directly into the current chat's textbox.
   - Gemini sees its own previous output and immediately produces the refined plan with full context continuity.

---

## 5. Rich-Text Editor Insertion & Extraction Dynamics

Gemini Web uses a Quill rich-text editor (`div[role="textbox"].ql-editor`).
- Plain DOM `element.value = ...` does not update Quill's internal Delta model and disables the Send button.
- G2A uses native keyboard insertion via `page.keyboard.insertText(promptText)` to trigger internal Quill mutation observers.
- Response completion detection:
  1. Counts initial response bubbles (`message-content`).
  2. Monitors until response bubble count increments.
  3. Polls until the "Stop" button disappears and the inner text length stabilizes over 3 consecutive polling intervals.

---

## 6. The 4-Tier Autonomous Bypass System

If Gemini Web flags a prompt or returns an incomplete response, G2A activates its 4-tier autonomous bypass without requiring human intervention:

| Tier | Strategy | Description |
|---|---|---|
| **Tier 1** | **Natural Directive Framing** | Strips strict constraint markers and reframes as a Principal Architect system document. |
| **Tier 2** | **Structural Data-Contract Inversion** | Converts operational action verbs into an objective Software Architecture & Type Contract Specification. |
| **Tier 3** | **Alternate Model Switching (3.1 Pro)** | Switches model to `3.1 Pro` in case `3.8 Flash` encountered a localized safety refusal. |
| **Tier 4** | **Fast Fallback (3.5 Flash-Lite)** | High-speed fallback to `3.5 Flash-Lite` to ensure continuous execution. |
