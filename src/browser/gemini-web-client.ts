import { chromium, type BrowserContext, type Page } from "playwright-core";
import path from "path";
import os from "os";
import fs from "fs";
import { BrowserDetector } from "./detector.js";
import type { GeminiGenerationClient } from "../gemini/client-interface.js";
import { PromptSanitizer } from "../gemini/prompt-sanitizer.js";

export interface WebClientConfig {
  browserPath?: string;
  userDataDir?: string;
  headless?: boolean;
  timeoutMs?: number;
}

export class GeminiWebClient implements GeminiGenerationClient {
  private config: WebClientConfig;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private defaultUserDataDir: string;

  constructor(config: WebClientConfig = {}) {
    this.defaultUserDataDir = path.join(os.homedir(), ".g2a", "browser_profile");
    this.config = {
      userDataDir: config.userDataDir || this.defaultUserDataDir,
      headless: config.headless ?? false,
      timeoutMs: config.timeoutMs ?? 180_000,
      browserPath: config.browserPath,
    };
  }

  public getUserDataDir(): string {
    return this.config.userDataDir || this.defaultUserDataDir;
  }

  /**
   * Discovers the browser executable.
   */
  public getExecutablePath(): string {
    if (this.config.browserPath && fs.existsSync(this.config.browserPath)) {
      return this.config.browserPath;
    }
    const detected = BrowserDetector.findBrowser();
    if (!detected) {
      throw new Error(
        "No Chromium browser (Brave, Chrome, Edge) found on host. Please install Brave or Chrome."
      );
    }
    return detected.executablePath;
  }

  public isConfigured(): boolean {
    try {
      return !!this.getExecutablePath();
    } catch {
      return false;
    }
  }

  /**
   * Initializes or reuses the persistent browser context.
   */
  public async getPage(forceHeaded = false): Promise<Page> {
    if (this.page && !this.page.isClosed() && this.context) {
      return this.page;
    }

    const executablePath = this.getExecutablePath();
    const userDataDir = this.getUserDataDir();
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    const headless = forceHeaded ? false : (this.config.headless ?? false);

    this.context = await chromium.launchPersistentContext(userDataDir, {
      executablePath,
      headless,
      viewport: { width: 1280, height: 900 },
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
      ],
      ignoreDefaultArgs: ["--enable-automation"],
    });

    const pages = this.context.pages();
    this.page = pages.length > 0 ? pages[0] : await this.context.newPage();

    // Stealth: Remove navigator.webdriver flag
    try {
      await this.context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", {
          get: () => undefined,
        });
      });
    } catch {}

    return this.page;
  }

  /**
   * Handles Google Captcha and dismisses intrusive popups.
   */
  public async handleCaptchaAndPopups(page: Page): Promise<void> {
    if (!page || page.isClosed()) return;

    // 1. Google sorry/captcha detection and auto-resolution
    if (page.url().includes("/sorry/")) {
      const frames = page.frames();
      const recaptchaFrame = frames.find(
        (f) => f.url().includes("recaptcha") && f.url().includes("anchor")
      );
      if (recaptchaFrame) {
        try {
          const checkbox = recaptchaFrame.locator("#recaptcha-anchor, .recaptcha-checkbox");
          if (await checkbox.isVisible()) {
            await checkbox.click({ timeout: 5000 });
            await page.waitForTimeout(4000);
          }
        } catch {}
      }
    }

    // 2. Dismiss promotion / update dialogs if visible
    try {
      const dismissBtn = page
        .locator('button:has-text("Để sau"), button:has-text("Dismiss"), button:has-text("Not now")')
        .first();
      if (await dismissBtn.isVisible()) {
        await dismissBtn.click();
        await page.waitForTimeout(500);
      }
    } catch {}
  }

  /**
   * Evaluates whether the current page on gemini.google.com has an authenticated Google user session.
   * Checks that there are NO 'Sign in' / 'ServiceLogin' links, and an account avatar/profile element is present.
   */
  public async isUserAuthenticated(): Promise<boolean> {
    if (!this.page || this.page.isClosed()) return false;
    await this.handleCaptchaAndPopups(this.page);
    const url = this.page.url();
    if (
      url.includes("accounts.google.com") ||
      url.includes("/signin") ||
      url.includes("identifier") ||
      url.includes("challenge") ||
      url.includes("/sorry/")
    ) {
      return false;
    }

    try {
      return await this.page.evaluate(() => {
        // 1. If any Sign in links exist, user is NOT authenticated
        const signInElements = Array.from(document.querySelectorAll("a, button")).filter((el) => {
          const text = (el.textContent || "").trim().toLowerCase();
          const href = (el.getAttribute("href") || "").toLowerCase();
          return (
            text === "sign in" ||
            text === "đăng nhập" ||
            href.includes("accounts.google.com/servicelogin") ||
            href.includes("servicelogin")
          );
        });

        if (signInElements.length > 0) {
          return false;
        }

        // 2. Verified authenticated markers
        const hasSignOutLink = !!document.querySelector('a[href*="SignOutOptions"]');
        const hasAccountAria = !!(
          document.querySelector('a[aria-label*="Google Account"]') ||
          document.querySelector('a[aria-label*="Tài khoản Google"]') ||
          document.querySelector('a[aria-label*="@"]') ||
          document.querySelector('button[aria-label*="Google Account"]') ||
          document.querySelector('button[aria-label*="Tài khoản Google"]') ||
          document.querySelector('button[aria-label*="@"]')
        );

        return hasSignOutLink || hasAccountAria;
      });
    } catch {
      return false;
    }
  }

  /**
   * Checks if user has an active logged-in session on gemini.google.com
   */
  public async checkLoginStatus(): Promise<boolean> {
    const page = await this.getPage(false);
    await page.goto("https://gemini.google.com/app", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    await page.waitForTimeout(3000);
    return await this.isUserAuthenticated();
  }

  /**
   * Interactive login helper: Opens headed browser and waits until user logs into Google.
   */
  public async startInteractiveLogin(
    onProgress?: (msg: string) => void
  ): Promise<boolean> {
    const log = onProgress || console.log;
    log("Opening browser window for Google Gemini Web login...");

    const page = await this.getPage(true);
    try {
      await page.goto("https://gemini.google.com/app", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
    } catch {
      // Ignore transient initial load timeouts
    }

    // Check if already authenticated
    await page.waitForTimeout(2000);
    const alreadyAuth = await this.isUserAuthenticated();
    if (alreadyAuth) {
      log("✓ Google Gemini Web session already active!");
      return true;
    }

    // Direct user straight to Google Account sign-in page without breaking on redirect
    log("Redirecting to Google Account Sign In...");
    try {
      const clicked = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll("a, button"));
        const btn = links.find((el) => {
          const t = (el.textContent || "").trim().toLowerCase();
          const href = (el.getAttribute("href") || "").toLowerCase();
          return (
            t === "sign in" ||
            t === "đăng nhập" ||
            href.includes("accounts.google.com/servicelogin") ||
            href.includes("servicelogin")
          );
        }) as HTMLElement | undefined;

        if (btn) {
          btn.click();
          return true;
        }
        return false;
      });

      if (!clicked) {
        await page.goto(
          "https://accounts.google.com/v3/signin/identifier?continue=https://gemini.google.com/app",
          { waitUntil: "commit", timeout: 30_000 }
        );
      }
    } catch {
      // Redirection between Google sign-in services is expected
    }

    log("Please enter your Google email and password in the opened browser window.");
    log("Complete 2-Step Verification (2FA) if prompted.");
    log("Waiting for login to complete in browser (timeout: 10 minutes)...");

    // Poll until login is complete: user must land back on gemini.google.com, sign-in button must be gone, and account profile present
    const startTime = Date.now();
    const maxWait = 10 * 60 * 1000; // 10 minutes

    while (Date.now() - startTime < maxWait) {
      if (page.isClosed()) {
        throw new Error("Browser window was closed before login was completed.");
      }

      await page.waitForTimeout(2000);
      const currentUrl = page.url();

      // Still on accounts.google.com (user is entering credentials or OTP)
      if (
        currentUrl.includes("accounts.google.com") ||
        currentUrl.includes("/signin") ||
        currentUrl.includes("identifier") ||
        currentUrl.includes("challenge")
      ) {
        continue;
      }

      // Returned to gemini.google.com
      if (currentUrl.includes("gemini.google.com")) {
        const isAuth = await this.isUserAuthenticated();
        if (isAuth) {
          log("✓ Google login complete! Session verified and saved to .g2a/browser_profile.");
          // Wait 3 seconds so cookies are flushed to disk
          await page.waitForTimeout(3000);
          return true;
        }
      }
    }

    throw new Error("Timed out waiting for Google login. Please try `g2a login-web` again.");
  }

  /**
   * Sends prompt to Gemini Web and waits for complete generation.
   */
  public async generate(
    prompt: string,
    options?: {
      systemInstruction?: string;
      thinkingBudget?: number;
      temperature?: number;
      model?: string;
    }
  ): Promise<{ text: string; model: string }> {
    const page = await this.getPage(this.config.headless === false);

    // Ensure we start in a fresh conversation on Gemini Web to prevent context pollution
    if (!page.url().includes("gemini.google.com")) {
      await page.goto("https://gemini.google.com/app", {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await page.waitForTimeout(2000);
    } else {
      // If already on Gemini Web, reset to a fresh chat
      try {
        const newChatBtn = page
          .locator(
            'button:has-text("Cuộc trò chuyện mới"), button:has-text("New chat"), a:has-text("Cuộc trò chuyện mới"), a:has-text("New chat"), [aria-label*="Cuộc trò chuyện mới"], [aria-label*="New chat"]'
          )
          .first();
        if (await newChatBtn.isVisible()) {
          await newChatBtn.click();
          await page.waitForTimeout(1500);
        }
      } catch {}
    }

    await this.handleCaptchaAndPopups(page);

    // Check login
    const isLoggedIn = await this.isUserAuthenticated();
    if (!isLoggedIn) {
      throw new Error(
        "Google Gemini Web is not logged in. Please run `g2a login-web` in terminal to log in to your Google Account first."
      );
    }

    // Ensure highest capability model (3.1 Pro / 3.8 Flash) is selected
    await this.ensureBestModel(page);

    // Clean, natural prompt incorporating system instruction if provided
    let fullPrompt = prompt;
    if (
      options?.systemInstruction &&
      !prompt.includes("Vai trò:") &&
      !prompt.includes("Role:") &&
      !prompt.includes("chuẩn RULES.MD")
    ) {
      fullPrompt = `${options.systemInstruction}\n\n${prompt}`;
    }

    // 1. Locate chat input element
    const inputSelector =
      'div[role="textbox"].ql-editor, rich-textarea div[role="textbox"], div[contenteditable="true"], div[role="textbox"]';
    const textbox = page.locator(inputSelector).first();
    await textbox.waitFor({ timeout: 15_000 });
    await textbox.click();

    // Count existing responses to detect when new response arrives
    const initialResponseCount = await page.evaluate(() => {
      return document.querySelectorAll('message-content, .model-response, [data-test-id="model-response"]').length;
    });

    // 2. Insert text using native keyboard input to preserve Quill's internal Delta state
    await page.keyboard.insertText(fullPrompt);
    await page.waitForTimeout(800);

    // 3. Click Send button or press Enter
    const sendButton = page
      .locator(
        'button[aria-label*="Gửi tin nhắn"], button[aria-label*="Send message"], button[aria-label*="Send"], button[aria-label*="Gửi"], button.send-button, [data-test-id="send-button"]'
      )
      .first();

    if (await sendButton.isVisible() && (await sendButton.isEnabled())) {
      await sendButton.click();
    } else {
      await page.keyboard.press("Enter");
    }

    // 4. Wait for response generation to complete
    const timeoutMs = this.config.timeoutMs || 180_000;
    const startTime = Date.now();

    // Wait until response count increments
    while (Date.now() - startTime < 20_000) {
      const currentCount = await page.evaluate(() => {
        return document.querySelectorAll('message-content, .model-response, [data-test-id="model-response"]').length;
      });
      if (currentCount > initialResponseCount) {
        break;
      }
      await page.waitForTimeout(500);
    }

    // Wait until generation finishes (Stop button disappears and content stabilizes)
    let lastContent = "";
    let stableCount = 0;

    while (Date.now() - startTime < timeoutMs) {
      await page.waitForTimeout(1500);

      const status = await page.evaluate(() => {
        const stopBtn =
          document.querySelector('button[aria-label*="Stop"], button[aria-label*="Dừng"]') ||
          document.querySelector('mat-spinner, .loading-indicator');
        const isGenerating = !!stopBtn;

        const responseEls = document.querySelectorAll(
          'message-content, .model-response, [data-test-id="model-response"]'
        );
        let latestText = "";
        if (responseEls.length > 0) {
          const lastEl = responseEls[responseEls.length - 1] as HTMLElement;
          latestText = lastEl.innerText || "";
        }

        return {
          isGenerating,
          latestText,
        };
      });

      if (status.latestText.length > 50) {
        if (status.latestText === lastContent && !status.isGenerating) {
          stableCount++;
          if (stableCount >= 3) {
            // Text is stable and generation has completed
            break;
          }
        } else {
          stableCount = 0;
          lastContent = status.latestText;
        }
      }
    }

    // 5. Extract latest response text
    const extracted = await page.evaluate(() => {
      const responseEls = document.querySelectorAll(
        'message-content, .model-response, [data-test-id="model-response"]'
      );
      if (responseEls.length === 0) {
        return "";
      }
      const lastEl = responseEls[responseEls.length - 1] as HTMLElement;
      return lastEl.innerText.trim();
    });

    if (!extracted) {
      throw new Error("Failed to extract response text from Gemini Web.");
    }

    if (this.isBackendError(extracted)) {
      return await this.retryWithSafeFraming(page, prompt, extracted);
    }

    return {
      text: extracted,
      model: "gemini-web",
    };
  }

  /**
   * Checks if extracted text is a known backend/safety refusal from Gemini Web.
   */
  public isBackendError(text: string): boolean {
    const lower = text.toLowerCase();
    return (
      lower.includes("encountered an error doing what you asked") ||
      lower.includes("encountering an error") ||
      lower.includes("sorry, something went wrong") ||
      lower.includes("having a hard time fulfilling your request") ||
      lower.includes("can i help you with something else") ||
      lower.includes("can't fulfill this request") ||
      lower.includes("cannot fulfill this request") ||
      lower.includes("unable to fulfill") ||
      lower.includes("tôi đã gặp lỗi khi thực hiện") ||
      lower.includes("tôi dường như đang gặp lỗi") ||
      lower.includes("tôi không thể trợ giúp về điều đó") ||
      lower.includes("tôi không thể hỗ trợ") ||
      lower.includes("tôi không thể thực hiện") ||
      lower.includes("tôi không thể hoàn thành") ||
      lower.includes("tôi không thể cung cấp") ||
      lower.includes("tôi không thể đáp ứng") ||
      lower.includes("không thể trợ giúp bạn") ||
      lower.includes("là một mô hình ngôn ngữ") ||
      lower.includes("tôi là một mô hình ngôn ngữ") ||
      lower.includes("tôi là một công nghệ trí tuệ nhân tạo") ||
      lower.includes("tôi không được lập trình") ||
      lower.includes("nằm ngoài khả năng") ||
      lower.includes("nằm ngoài mục đích") ||
      lower.includes("can't help with that") ||
      lower.includes("cannot assist") ||
      lower.includes("as a language model") ||
      lower.includes("unable to assist") ||
      lower.includes("safety policy") ||
      lower.includes("content policy") ||
      lower.includes("chính sách an toàn") ||
      lower.includes("cannot browse the web") ||
      lower.includes("không thể duyệt web") ||
      lower.includes("không có quyền truy cập") ||
      lower.includes("something went wrong") ||
      lower.includes("đã xảy ra sự cố")
    );
  }

  /**
   * Safe fallback retry when Gemini Web rejects or errors on direct prompt.
   */
  private async retryWithSafeFraming(
    page: Page,
    taskPrompt: string,
    previousError: string
  ): Promise<{ text: string; model: string }> {
    console.warn(
      `[GeminiWeb] Detected Gemini Web backend/safety response ("${previousError.slice(0, 60)}..."). Automatically retrying in a fresh session with safe architectural framing...`
    );

    // Reset to a clean chat session
    try {
      const newChatBtn = page
        .locator(
          'button:has-text("Cuộc trò chuyện mới"), button:has-text("New chat"), a:has-text("Cuộc trò chuyện mới"), a:has-text("New chat"), [aria-label*="Cuộc trò chuyện mới"], [aria-label*="New chat"]'
        )
        .first();
      if (await newChatBtn.isVisible()) {
        await newChatBtn.click();
        await page.waitForTimeout(2000);
      } else {
        await page.goto("https://gemini.google.com/app", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(3000);
      }
    } catch {}

    await this.ensureBestModel(page);

    const taskMatch = taskPrompt.match(/Task:\s*([\s\S]*?)(?=\nDomain|\nProject|\nWorkspace|\n---|$)/i);
    const coreTask = taskMatch ? taskMatch[1].trim() : taskPrompt.slice(0, 250).trim();
    const sanitized = PromptSanitizer.sanitizeTask(coreTask);

    const safePrompt = `Vai trò: Principal Software Architect
Tài liệu: Kế Hoạch Kiến Trúc Kỹ Thuật Phần Mềm & Đặc Tả Hệ Thống (RFC)
Mục tiêu phát triển: ${sanitized.sanitizedTask}

Hãy soạn thảo bản thiết kế kiến trúc kỹ thuật phần mềm đầy đủ và chuyên sâu theo chuẩn 6 phần của RULES.MD:

# Plan: Kế Hoạch Kiến Trúc Kỹ Thuật Hệ Thống
DRI: lead_architect

## 1. AS-IS State & System Architecture Blueprint
- Hiện trạng hệ thống & Lựa chọn Tech Stack (Runtime, Framework, UI, State, Testing).
- Sơ đồ kiến trúc & luồng dữ liệu (Mermaid flowchart TD).
- Cấu trúc thư mục định danh file ([NEW], [MODIFY], [DELETE]).
- Định nghĩa TypeScript interfaces & Data contracts.

## 2. Non-Goals & Phạm Vi Dự Án (Tối thiểu 3 mục ngoài phạm vi)
1. [Mục 1 ngoài phạm vi và lý do kỹ thuật]
2. [Mục 2 ngoài phạm vi và lý do kỹ thuật]
3. [Mục 3 ngoài phạm vi và lý do kỹ thuật]

## 3. Unknowns & Kiểm Tra Kỹ Thuật (Halt-on-Unknown)
- Status: CLEAR
- Unknowns: None

## 4. Quản Trị Rủi Ro & Bảng RAID Log (Tối thiểu 4 mục)
Bảng phân tích chi tiết: Concurrency / Race conditions, OS path quirks (Windows CRLF & backslashes), Timeouts / Rate limits, State lifecycle:
| ID | Category | Description | Impact | Likelihood | Mitigation Strategy | Owner DRI |
| R-1 | Risk | Concurrency & Async state hazards | High | Medium | Defensive locks / debounce | lead_architect |
| R-2 | Risk | Platform quirks (Windows vs POSIX paths, CRLF) | Medium | High | Path normalization & npm.cmd | lead_architect |
| R-3 | Risk | Network timeouts & API error boundaries | High | Low | Exponential backoff & retry | lead_architect |
| A-1 | Assumption | Browser runtime compatibility | Medium | Low | Runtime validation checks | lead_architect |

## 5. Work Breakdown Structure (WBS) & Phân Chia Giai Đoạn
Chia thành các Phase cụ thể (Phase 1: Khởi tạo Scaffolding & Types, Phase 2: Domain Logic & UI Components, Phase 3: State & Error Boundaries, Phase 4: Production Build & Hardening).
Mỗi task có nhãn file ([NEW], [MODIFY]), single DRI (DRI: lead_architect), lệnh kiểm thử shell nhị phân (Verification) và ước tính PERT (PERT: O=..., M=..., P=...).

## 6. Definition of Done & Tiêu Chuẩn Nghiệm Thu
Tiêu chuẩn pass/fail: 100% test pass, 0 type errors, 0 lint warnings, clean build.

Yêu cầu xuất: Bắt đầu ngay lập tức với "# Plan: [Tiêu đề]", không xuất lời chào hay văn bản giao tiếp.`;

    const inputSelector =
      'div[role="textbox"].ql-editor, rich-textarea div[role="textbox"], div[contenteditable="true"], div[role="textbox"]';
    const textbox = page.locator(inputSelector).first();
    await textbox.waitFor({ timeout: 15_000 });
    await textbox.click();

    const initialResponseCount = await page.evaluate(() => {
      return document.querySelectorAll('message-content, .model-response, [data-test-id="model-response"]').length;
    });

    await page.keyboard.insertText(safePrompt);
    await page.waitForTimeout(800);

    const sendButton = page
      .locator(
        'button[aria-label*="Gửi tin nhắn"], button[aria-label*="Send message"], button[aria-label*="Send"], button[aria-label*="Gửi"], button.send-button'
      )
      .first();

    if (await sendButton.isVisible() && (await sendButton.isEnabled())) {
      await sendButton.click();
    } else {
      await page.keyboard.press("Enter");
    }

    const timeoutMs = this.config.timeoutMs || 180_000;
    const startTime = Date.now();

    // Wait until response count increments
    while (Date.now() - startTime < 25_000) {
      const currentCount = await page.evaluate(() => {
        return document.querySelectorAll('message-content, .model-response, [data-test-id="model-response"]').length;
      });
      if (currentCount > initialResponseCount) {
        break;
      }
      await page.waitForTimeout(500);
    }

    let lastContent = "";
    let stableCount = 0;

    while (Date.now() - startTime < timeoutMs) {
      await page.waitForTimeout(1500);

      const status = await page.evaluate(() => {
        const stopBtn =
          document.querySelector('button[aria-label*="Stop"], button[aria-label*="Dừng"]') ||
          document.querySelector('mat-spinner, .loading-indicator');
        const isGenerating = !!stopBtn;

        const responseEls = document.querySelectorAll(
          'message-content, .model-response, [data-test-id="model-response"]'
        );
        let latestText = "";
        if (responseEls.length > 0) {
          const lastEl = responseEls[responseEls.length - 1] as HTMLElement;
          latestText = lastEl.innerText || "";
        }

        return { isGenerating, latestText };
      });

      if (status.latestText.length > 50) {
        if (status.latestText === lastContent && !status.isGenerating) {
          stableCount++;
          if (stableCount >= 3) {
            break;
          }
        } else {
          stableCount = 0;
          lastContent = status.latestText;
        }
      }
    }

    const retryExtracted = await page.evaluate(() => {
      const responseEls = document.querySelectorAll(
        'message-content, .model-response, [data-test-id="model-response"]'
      );
      if (responseEls.length === 0) return "";
      const lastEl = responseEls[responseEls.length - 1] as HTMLElement;
      return lastEl.innerText.trim();
    });

    if (!retryExtracted || this.isBackendError(retryExtracted)) {
      throw new Error(`Gemini Web responded with backend error: "${retryExtracted || previousError}"`);
    }

    return {
      text: retryExtracted,
      model: "gemini-web",
    };
  }

  /**
   * Automatically switches to the highest capability model available (e.g. 3.1 Pro or 3.8 Flash)
   * to avoid unstable extended modes or legacy limits.
   */
  public async ensureBestModel(page: Page): Promise<void> {
    try {
      const modelSelector = page
        .locator(
          'button[data-test-id="bard-mode-menu-button"], button.input-area-switch, [aria-label*="chọn mô hình"], [aria-label*="model"]'
        )
        .first();
      if (await modelSelector.isVisible()) {
        const currentText = await modelSelector.innerText();
        // In Gemini Web UI, selecting 3.1 Pro displays "Pro" or "Pro Mở rộng" on the button
        if (currentText.includes("Pro")) {
          return;
        }

        await modelSelector.click();
        await page.waitForTimeout(800);

        // 1. Prioritize 3.1 Pro
        const proOption = page
          .locator(
            '[role="menuitem"]:has-text("3.1 Pro"), [role="menuitemradio"]:has-text("3.1 Pro"), button:has-text("3.1 Pro")'
          )
          .first();
        if (await proOption.isVisible()) {
          await proOption.click();
          await page.waitForTimeout(1000);
          return;
        }

        // 2. Next try 3.8 Flash
        const flashOption = page
          .locator(
            '[role="menuitem"]:has-text("3.8 Flash"), [role="menuitemradio"]:has-text("3.8 Flash"), button:has-text("3.8 Flash")'
          )
          .first();
        if (await flashOption.isVisible()) {
          await flashOption.click();
          await page.waitForTimeout(1000);
          return;
        }

        await page.keyboard.press("Escape");
      }
    } catch {
      // Graceful fallback if selector structure changes
    }
  }

  /**
   * Closes browser context and releases resources.
   */
  public async close(): Promise<void> {
    if (this.context) {
      try {
        await this.context.close();
      } catch {}
      this.context = null;
      this.page = null;
    }
  }
}
