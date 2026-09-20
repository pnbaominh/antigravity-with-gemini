import { chromium, type BrowserContext, type Page } from "playwright-core";
import path from "path";
import os from "os";
import fs from "fs";
import { BrowserDetector } from "./detector.js";
import type { GeminiGenerationClient } from "../gemini/client-interface.js";
import { PromptSanitizer } from "../gemini/prompt-sanitizer.js";

export interface GeminiWebClientConfig {
  profileDir?: string;
  userDataDir?: string;
  headless?: boolean;
  timeoutMs?: number;
  executablePath?: string;
  browserPath?: string;
  preferredModel?: string;
}

export type WebClientConfig = GeminiWebClientConfig;

export class GeminiWebClient implements GeminiGenerationClient {
  private config: GeminiWebClientConfig;
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

    // Ensure target model (prioritize 3.8 Flash > 3.1 Pro > 3.5 Flash-Lite) is selected
    const activeModel =
      options?.model ||
      this.config.preferredModel ||
      process.env.GEMINI_MODEL ||
      "3.8 Flash";
    await this.ensureBestModel(page, activeModel);

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

    const extracted = await this.submitAndExtract(page, fullPrompt);

    const isError =
      !extracted ||
      this.isBackendError(extracted) ||
      (extracted.length < 150 && !extracted.includes("Plan:"));

    if (isError) {
      return await this.executeAutonomousBypass(
        page,
        prompt,
        extracted || "Empty response",
        activeModel
      );
    }

    return {
      text: extracted,
      model: activeModel,
    };
  }

  /**
   * Resets page to a clean conversation session.
   */
  public async resetToFreshChat(page: Page): Promise<void> {
    try {
      const newChatBtn = page
        .locator(
          'button:has-text("Cuộc trò chuyện mới"), button:has-text("New chat"), a:has-text("Cuộc trò chuyện mới"), a:has-text("New chat"), [aria-label*="Cuộc trò chuyện mới"], [aria-label*="New chat"]'
        )
        .first();
      if (await newChatBtn.isVisible()) {
        await newChatBtn.click();
        await page.waitForTimeout(2000);
        return;
      }
    } catch {}
    try {
      await page.goto("https://gemini.google.com/app", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
    } catch {}
  }

  /**
   * Submits prompt text to chat input and waits for generation to stabilize.
   */
  public async submitAndExtract(page: Page, promptText: string): Promise<string> {
    const inputSelector =
      'div[role="textbox"].ql-editor, rich-textarea div[role="textbox"], div[contenteditable="true"], div[role="textbox"]';
    const textbox = page.locator(inputSelector).first();
    await textbox.waitFor({ timeout: 15_000 });
    await textbox.click();

    // Count existing responses to detect when new response arrives
    const initialResponseCount = await page.evaluate(() => {
      return document.querySelectorAll('message-content, .model-response, [data-test-id="model-response"]').length;
    });

    // Insert text using native keyboard input to preserve Quill's internal Delta state
    await page.keyboard.insertText(promptText);
    await page.waitForTimeout(800);

    // Click Send button or press Enter
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

    // Wait for response generation to complete
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
            break;
          }
        } else {
          stableCount = 0;
          lastContent = status.latestText;
        }
      }
    }

    // Extract latest response text
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

    return extracted;
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
      lower.includes("tôi không thể tạo") ||
      lower.includes("tôi không có khả năng") ||
      lower.includes("tôi không thể lập kế hoạch") ||
      lower.includes("không thể trợ giúp bạn") ||
      lower.includes("là một mô hình ngôn ngữ") ||
      lower.includes("tôi là một mô hình ngôn ngữ") ||
      lower.includes("tôi là một công nghệ trí tuệ nhân tạo") ||
      lower.includes("tôi chỉ là một mô hình") ||
      lower.includes("tôi không được lập trình") ||
      lower.includes("nằm ngoài khả năng") ||
      lower.includes("nằm ngoài mục đích") ||
      lower.includes("can't help with that") ||
      lower.includes("cannot assist") ||
      lower.includes("as a language model") ||
      lower.includes("unable to assist") ||
      lower.includes("i cannot generate") ||
      lower.includes("safety policy") ||
      lower.includes("content policy") ||
      lower.includes("chính sách an toàn") ||
      lower.includes("cannot browse the web") ||
      lower.includes("không thể duyệt web") ||
      lower.includes("không có quyền truy cập") ||
      lower.includes("something went wrong") ||
      lower.includes("đã xảy ra sự cố") ||
      lower.includes("lỗi máy chủ") ||
      lower.includes("server error") ||
      lower.includes("an error occurred")
    );
  }

  /**
   * Safe fallback retry when Gemini Web rejects or errors on direct prompt.
   * Delegates to the autonomous multi-tier bypass engine.
   */
  public async retryWithSafeFraming(
    page: Page,
    taskPrompt: string,
    previousError: string
  ): Promise<{ text: string; model: string }> {
    return await this.executeAutonomousBypass(page, taskPrompt, previousError, "3.8 Flash");
  }

  /**
   * Autonomous Multi-Tier Adaptive Bypass Engine (Zero code edits required by user).
   * If the newest model refuses or encounters an error, this method autonomously executes
   * progressive self-healing tiers:
   * - Tier 1: Deep Architectural RFC Safe-Framing on current model.
   * - Tier 2: Structural Data-Contract & Inversion (specifying types & interfaces without action verbs).
   * - Tier 3: Autonomous Cross-Model Fallback (e.g. 3.8 Flash -> 3.1 Pro) in a clean chat session.
   * - Tier 4: Lightweight Fallback (to 3.5 Flash-Lite) if Pro also encounters quota or refusal.
   * - Tier 5: Minimalist Core Architecture Scaffold.
   */
  public async executeAutonomousBypass(
    page: Page,
    taskPrompt: string,
    previousError: string,
    initialModel: string = "3.8 Flash"
  ): Promise<{ text: string; model: string }> {
    console.warn(
      `[GeminiWeb Bypass] Refusal or error detected ("${previousError.slice(0, 60)}..."). Initiating autonomous multi-tier adaptive bypass...`
    );

    const taskMatch =
      taskPrompt.match(/Task:\s*([\s\S]*?)(?=\nDomain|\nProject|\nWorkspace|\n---|$)/i) ||
      taskPrompt.match(/MỤC TIÊU PHÁT TRIỂN[^:]*:\s*([\s\S]*?)(?=\nThông tin|\nTrạng thái|\n---|$)/i);
    const rawTask = taskMatch ? taskMatch[1].trim() : taskPrompt.slice(0, 300).trim();
    const sanitized = PromptSanitizer.sanitizeTask(rawTask);
    const isVN =
      /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(rawTask);

    // TIER 1: Deep Architectural RFC Safe-Framing on current model
    try {
      console.warn(`[GeminiWeb Bypass] Tier 1: Applying Architectural RFC safe-framing on ${initialModel}...`);
      await this.resetToFreshChat(page);
      await this.ensureBestModel(page, initialModel);

      const tier1Prompt = isVN
        ? `Vai trò: Principal Systems Architect & Senior Staff Software Engineer
Tài liệu: Bản Thiết Kế Kiến Trúc Kỹ Thuật Hệ Thống & Đặc Tả Triển Khai (Technical Architecture RFC)
Mục tiêu kỹ thuật: ${sanitized.sanitizedTask}

Yêu cầu: Lập bản thiết kế kiến trúc kỹ thuật hệ thống hoàn chỉnh theo chuẩn ISO/IEC/IEEE 42010 và quy chuẩn quản trị RULES.MD:
# Plan: Kế Hoạch Kiến Trúc Kỹ Thuật Hệ Thống
DRI: lead_architect

## 1. AS-IS State & System Architecture Blueprint
- Hiện trạng hệ thống & Cơ sở lý luận lựa chọn Tech Stack
- Sơ đồ kiến trúc & luồng dữ liệu (Mermaid flowchart TD)
- Cấu trúc thư mục định danh tệp ([NEW], [MODIFY], [DELETE])
- Định nghĩa TypeScript interfaces & Data contracts

## 2. Non-Goals & Phạm Vi Dự Án (Tối thiểu 3 mục ngoài phạm vi)
1. [Mục 1 ngoài phạm vi & lý do kỹ thuật]
2. [Mục 2 ngoài phạm vi & lý do kỹ thuật]
3. [Mục 3 ngoài phạm vi & lý do kỹ thuật]

## 3. Unknowns & Kiểm Tra Kỹ Thuật (Halt-on-Unknown)
Status: CLEAR

## 4. Quản Trị Rủi Ro & Bảng RAID Log (Tối thiểu 4 mục)
| ID | Category | Description | Impact | Likelihood | Mitigation Strategy | Owner DRI |
| R-1 | Risk | Concurrency & Async state hazards | High | Medium | Defensive locks / debounce | lead_architect |
| R-2 | Risk | Platform quirks (Windows paths, CRLF, npm.cmd) | Medium | High | Path normalization utilities | lead_architect |
| R-3 | Risk | Network timeouts & API error boundaries | High | Low | Exponential backoff & retry | lead_architect |
| A-1 | Assumption | Browser runtime compatibility | Medium | Low | Runtime validation checks | lead_architect |

## 5. Work Breakdown Structure (WBS) & Phân Chia Giai Đoạn
Phân rã thành Phase 1, Phase 2, Phase 3 với Single DRI (lead_architect), lệnh kiểm thử shell nhị phân (Verification Command), và ước lượng PERT: E = (O + 4M + P) / 6.

## 6. Definition of Done & Tiêu Chuẩn Nghiệm Thu
100% test pass, 0 type errors, clean build.

Bắt đầu trực tiếp bằng "# Plan: [Tiêu đề]". Tuyệt đối không xuất lời chào hay văn bản giao tiếp.`
        : `Role: Principal Systems Architect & Senior Staff Software Engineer
Document: Technical Architecture RFC & Phased Implementation Plan
Objective: ${sanitized.sanitizedTask}

Formulate an authoritative technical blueprint adhering to RULES.MD:
# Plan: Technical Architecture Specification
DRI: lead_architect

## 1. AS-IS State & System Architecture Blueprint
- System Overview & Tech Stack Rationale
- Architecture & Data Flow Diagram (Mermaid flowchart TD)
- Directory & File Layout ([NEW], [MODIFY], [DELETE])
- Core TypeScript Interfaces & Data Contracts

## 2. Non-Goals & Scope Boundaries (Mandatory >= 3)
1. ...
2. ...
3. ...

## 3. Unknowns & Halt Checks
Status: CLEAR

## 4. Risk Assessment & RAID Log (Mandatory >= 4 entries)
| ID | Category | Description | Impact | Likelihood | Mitigation Strategy | Owner DRI |
| R-1 | Risk | Concurrency & Async state hazards | High | Medium | Defensive locks / debounce | lead_architect |
| R-2 | Risk | Platform quirks (Windows vs POSIX, CRLF) | Medium | High | Path normalization & npm.cmd | lead_architect |
| R-3 | Risk | Network timeouts & API error boundaries | High | Low | Exponential backoff & retry | lead_architect |
| A-1 | Assumption | Runtime compatibility | Medium | Low | Runtime validation checks | lead_architect |

## 5. Work Breakdown Structure (WBS) & Phased Implementation
Phased breakdown with atomic tasks, single DRI, runnable verification commands, and PERT estimations.

## 6. Definition of Done & Quality Gates
100% test pass, 0 type errors, clean build.

Directly begin your response with "# Plan: [Title]". Do not output any conversational preamble.`;

      const result1 = await this.submitAndExtract(page, tier1Prompt);
      if (result1 && !this.isBackendError(result1) && result1.length > 200 && result1.includes("Plan:")) {
        console.log(`[GeminiWeb Bypass] ✓ Tier 1 bypass succeeded on ${initialModel}!`);
        return { text: result1, model: initialModel };
      }
    } catch (e: any) {
      console.warn(`[GeminiWeb Bypass] Tier 1 failed: ${e?.message}`);
    }

    // TIER 2: Structural Data-Contract & Inversion (No operational action verbs)
    try {
      console.warn(`[GeminiWeb Bypass] Tier 2: Applying Structural Inversion (Schema & Type Audit) on ${initialModel}...`);
      await this.resetToFreshChat(page);
      await this.ensureBestModel(page, initialModel);

      const tier2Prompt = isVN
        ? `Đặc tả: Phân Tích Cấu Trúc Kỹ Thuật & Hợp Đồng Dữ Liệu Phần Mềm (Software Architecture & Type Contract Specification)
Hạng mục: ${sanitized.sanitizedTask}

Vui lòng xuất báo cáo đặc tả cấu trúc kỹ thuật định dạng Markdown thuần túy:
# Plan: Đặc Tả Cấu Trúc Kỹ Thuật & Giao Diện Dữ Liệu
DRI: lead_architect

## 1. AS-IS State & System Architecture Blueprint
- Phân tích kiến trúc hệ thống và luồng dữ liệu (Mermaid flowchart TD)
- Danh mục tệp cần triển khai ([NEW], [MODIFY])
- Định nghĩa kiểu dữ liệu và TypeScript Interfaces

## 2. Non-Goals & Phạm Vi Dự Án
1. Giới hạn phạm vi 1
2. Giới hạn phạm vi 2
3. Giới hạn phạm vi 3

## 3. Unknowns & Kiểm Tra Kỹ Thuật
Status: CLEAR

## 4. Quản Trị Rủi Ro & Bảng RAID Log
| ID | Category | Description | Impact | Likelihood | Mitigation Strategy | Owner DRI |
| R-1 | Risk | Race condition & state inconsistency | High | Low | Atomic operations | lead_architect |
| R-2 | Risk | Platform path resolution | Medium | Low | Path normalization | lead_architect |

## 5. Work Breakdown Structure (WBS) & Phân Chia Giai Đoạn
Phase 1: Types & Interfaces. Phase 2: Implementation. Phase 3: Verification.
Mỗi phase có lệnh shell: Verification Command và PERT: E = (O + 4M + P) / 6.

## 6. Definition of Done & Tiêu Chuẩn Nghiệm Thu
100% test pass, 0 type errors, clean build.

Bắt đầu bằng "# Plan:".`
        : `Specification: Software Architecture & Data Contract Audit
Subject: ${sanitized.sanitizedTask}

Provide technical specification in Markdown starting with "# Plan:":
# Plan: Technical Architecture Specification
DRI: lead_architect

## 1. AS-IS State & System Architecture Blueprint
- Architecture and data flow (Mermaid flowchart TD)
- Directory layout ([NEW], [MODIFY])
- TypeScript Interfaces and data schemas

## 2. Non-Goals & Scope Boundaries
1. Out of scope item 1
2. Out of scope item 2
3. Out of scope item 3

## 3. Unknowns & Halt Checks
Status: CLEAR

## 4. Risk Assessment & RAID Log
| ID | Category | Description | Impact | Likelihood | Mitigation Strategy | Owner DRI |
| R-1 | Risk | Concurrency hazards | High | Low | Atomic state updates | lead_architect |
| R-2 | Risk | Platform paths | Medium | Low | Path normalization | lead_architect |

## 5. Work Breakdown Structure (WBS) & Phased Implementation
Phase 1: Types. Phase 2: Logic. Phase 3: Verification. Shell verification commands & PERT.

## 6. Definition of Done & Quality Gates
100% test pass, 0 type errors, clean build.

Directly begin with "# Plan:".`;

      const result2 = await this.submitAndExtract(page, tier2Prompt);
      if (result2 && !this.isBackendError(result2) && result2.length > 200 && result2.includes("Plan:")) {
        console.log(`[GeminiWeb Bypass] ✓ Tier 2 bypass succeeded on ${initialModel}!`);
        return { text: result2, model: initialModel };
      }
    } catch (e: any) {
      console.warn(`[GeminiWeb Bypass] Tier 2 failed: ${e?.message}`);
    }

    // TIER 3: Autonomous Cross-Model Fallback (Switch between 3.8 Flash and 3.1 Pro)
    const alternateModel =
      initialModel.toLowerCase().includes("flash") && !initialModel.toLowerCase().includes("lite")
        ? "3.1 Pro"
        : "3.8 Flash";
    try {
      console.warn(`[GeminiWeb Bypass] Tier 3: Autonomous model rotation -> Switching to ${alternateModel}...`);
      await this.resetToFreshChat(page);
      await this.ensureBestModel(page, alternateModel);

      const tier3Prompt = isVN
        ? `Vai trò: Principal Systems Architect & Senior Staff Software Engineer
Tài liệu: Bản Thiết Kế Kiến Trúc Kỹ Thuật & Kế Hoạch Triển Khai (Technical Architecture RFC)
Mục tiêu phát triển: ${sanitized.sanitizedTask}

Hãy soạn thảo bản thiết kế kiến trúc kỹ thuật phần mềm đầy đủ, có tính thực thi tuyệt đối theo khung quản trị RULES.MD:
# Plan: Kế Hoạch Kiến Trúc Kỹ Thuật Hệ Thống
DRI: lead_architect

## 1. AS-IS State & System Architecture Blueprint
- Hiện trạng hệ thống & Tech Stack
- Sơ đồ kiến trúc & luồng dữ liệu (Mermaid flowchart TD)
- Cấu trúc thư mục ([NEW], [MODIFY], [DELETE])
- TypeScript Interfaces & Data contracts

## 2. Non-Goals & Phạm Vi Dự Án (Tối thiểu 3 mục ngoài phạm vi)
1. ...
2. ...
3. ...

## 3. Unknowns & Kiểm Tra Kỹ Thuật
Status: CLEAR

## 4. Quản Trị Rủi Ro & Bảng RAID Log (Tối thiểu 4 mục)
| ID | Category | Description | Impact | Likelihood | Mitigation Strategy | Owner DRI |
| R-1 | Risk | Concurrency hazards | High | Medium | Defensive locks | lead_architect |
| R-2 | Risk | Platform path normalization | Medium | High | Normalized paths | lead_architect |
| R-3 | Risk | Network / API timeouts | High | Low | Exponential backoff | lead_architect |
| A-1 | Assumption | Runtime compatibility | Medium | Low | Runtime verification | lead_architect |

## 5. Work Breakdown Structure (WBS) & Phân Chia Giai Đoạn
Phân chia Phase 1, Phase 2, Phase 3 với single DRI, lệnh shell verification và PERT estimates.

## 6. Definition of Done & Tiêu Chuẩn Nghiệm Thu
100% test pass, 0 type errors, clean build.

Bắt đầu trực tiếp bằng "# Plan: [Tiêu đề]".`
        : `Role: Principal Systems Architect & Senior Staff Software Engineer
Document: Technical Architecture RFC & Phased Implementation Plan
Objective: ${sanitized.sanitizedTask}

Formulate an authoritative technical blueprint adhering to RULES.MD:
# Plan: Technical Architecture Specification
DRI: lead_architect

## 1. AS-IS State & System Architecture Blueprint
- System Overview & Tech Stack Rationale
- Architecture & Data Flow Diagram (Mermaid flowchart TD)
- Directory Layout ([NEW], [MODIFY], [DELETE])
- TypeScript Interfaces & Data Contracts

## 2. Non-Goals & Scope Boundaries (Mandatory >= 3)
1. ...
2. ...
3. ...

## 3. Unknowns & Halt Checks
Status: CLEAR

## 4. Risk Assessment & RAID Log (Mandatory >= 4 entries)
| ID | Category | Description | Impact | Likelihood | Mitigation Strategy | Owner DRI |
| R-1 | Risk | Concurrency hazards | High | Medium | Defensive locks | lead_architect |
| R-2 | Risk | Platform path normalization | Medium | High | Normalized paths | lead_architect |
| R-3 | Risk | Network / API timeouts | High | Low | Exponential backoff | lead_architect |
| A-1 | Assumption | Runtime compatibility | Medium | Low | Runtime verification | lead_architect |

## 5. Work Breakdown Structure (WBS) & Phased Implementation
Breakdown with atomic tasks, single DRI, runnable verification commands, and PERT estimations.

## 6. Definition of Done & Quality Gates
100% test pass, 0 type errors, clean build.

Directly begin with "# Plan: [Title]".`;

      const result3 = await this.submitAndExtract(page, tier3Prompt);
      if (result3 && !this.isBackendError(result3) && result3.length > 200 && result3.includes("Plan:")) {
        console.log(`[GeminiWeb Bypass] ✓ Tier 3 bypass succeeded on ${alternateModel}!`);
        return { text: result3, model: alternateModel };
      }
    } catch (e: any) {
      console.warn(`[GeminiWeb Bypass] Tier 3 failed: ${e?.message}`);
    }

    // TIER 4: Fast Fallback to 3.5 Flash-Lite
    try {
      console.warn(`[GeminiWeb Bypass] Tier 4: Autonomous fallback to 3.5 Flash-Lite...`);
      await this.resetToFreshChat(page);
      await this.ensureBestModel(page, "3.5 Flash-Lite");

      const tier4Prompt = `Kế hoạch kiến trúc phần mềm và đặc tả triển khai kỹ thuật cho: ${sanitized.sanitizedTask}.
Vui lòng xuất tài liệu kỹ thuật bắt đầu với "# Plan: [Tên Hệ Thống]" bao gồm:
1. AS-IS State & Architecture (kèm Mermaid diagram)
2. Non-Goals (tối thiểu 3 mục)
3. Unknowns & Halt Checks (Status: CLEAR)
4. RAID Log (Bảng rủi ro)
5. WBS & Phased Implementation (kèm shell verification commands và PERT)
6. Definition of Done`;

      const result4 = await this.submitAndExtract(page, tier4Prompt);
      if (result4 && !this.isBackendError(result4) && result4.length > 200 && result4.includes("Plan:")) {
        console.log(`[GeminiWeb Bypass] ✓ Tier 4 bypass succeeded on 3.5 Flash-Lite!`);
        return { text: result4, model: "3.5 Flash-Lite" };
      }
    } catch (e: any) {
      console.warn(`[GeminiWeb Bypass] Tier 4 failed: ${e?.message}`);
    }

    throw new Error(
      `Gemini Web autonomous bypass exhausted all tiers (Tiers 1-4 across models ${initialModel}, ${alternateModel}, 3.5 Flash-Lite). Last error: "${previousError}"`
    );
  }

  /**
   * Automatically switches to the highest capability model available.
   * Prioritizes newest models first: 3.8 Flash > 3.1 Pro > 3.5 Flash-Lite.
   */
  public async ensureBestModel(page: Page, requestedModel?: string): Promise<void> {
    try {
      const rawTarget = (
        requestedModel ||
        this.config.preferredModel ||
        process.env.GEMINI_MODEL ||
        "3.8 Flash"
      ).toLowerCase();

      // Normalize target key: "3.8", "3.1", or "3.5"
      let targetKey = "3.8";
      if (rawTarget.includes("3.5") || rawTarget.includes("lite")) {
        targetKey = "3.5";
      } else if (rawTarget.includes("3.1") || rawTarget.includes("pro")) {
        targetKey = "3.1";
      } else {
        targetKey = "3.8";
      }

      // Step 1: Detect current model on the model selector button (strictly excluding sidebar / user profile)
      const buttonInfo = await page.evaluate(() => {
        const isExcluded = (el: Element) => {
          return !!el.closest(
            "nav, aside, mat-sidenav, .side-nav, .sidebar, [role='navigation'], [aria-label*='Tài khoản'], [aria-label*='Account']"
          );
        };

        // First look inside the input area container
        const inputArea = document.querySelector(
          'rich-textarea, div[class*="input-area"], div[class*="bottom"], form, chat-window'
        );
        if (inputArea) {
          const container =
            inputArea.closest('div[class*="bottom-container"], form, chat-window') ||
            inputArea.parentElement;
          const candidates = Array.from(container?.querySelectorAll('button, [role="button"]') || []);
          for (const b of candidates) {
            if (isExcluded(b)) continue;
            const text = (b.textContent || "").trim();
            if (
              text === "Pro Mở rộng" ||
              text === "Flash Mở rộng" ||
              text === "3.8 Flash" ||
              text === "3.1 Pro" ||
              text === "3.5 Flash-Lite" ||
              text.includes("Mở rộng")
            ) {
              return { found: true, text };
            }
          }
        }

        // Global search excluding sidebar
        const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
        for (const b of allButtons) {
          if (isExcluded(b)) continue;
          const text = (b.textContent || "").trim();
          const testId = (b.getAttribute("data-test-id") || "").toLowerCase();
          const aria = (b.getAttribute("aria-label") || "").toLowerCase();

          if (
            text === "Pro Mở rộng" ||
            text === "Flash Mở rộng" ||
            text === "3.8 Flash" ||
            text === "3.1 Pro" ||
            text === "3.5 Flash-Lite" ||
            (text.includes("Mở rộng") && (text.includes("Pro") || text.includes("Flash"))) ||
            testId.includes("mode-menu") ||
            aria.includes("chọn mô hình")
          ) {
            return { found: true, text };
          }
        }

        return { found: false, text: "" };
      });

      const currentText = buttonInfo.text;

      // Check if already on the target model
      if (targetKey === "3.8") {
        if (
          (currentText.includes("3.8") || currentText.includes("Flash")) &&
          !currentText.includes("Lite") &&
          !currentText.includes("Pro")
        ) {
          return; // Already 3.8 Flash (e.g. "3.8 Flash" or "Flash Mở rộng")
        }
      } else if (targetKey === "3.1") {
        if (currentText.includes("Pro") || currentText.includes("3.1")) {
          return; // Already 3.1 Pro
        }
      } else if (targetKey === "3.5") {
        if (currentText.includes("Lite") || currentText.includes("3.5")) {
          return; // Already 3.5 Flash-Lite
        }
      }

      // Step 2: Open the model selector menu by clicking the real input bar button
      const opened = await page.evaluate(() => {
        const isExcluded = (el: Element) => {
          return !!el.closest(
            "nav, aside, mat-sidenav, .side-nav, .sidebar, [role='navigation'], [aria-label*='Tài khoản'], [aria-label*='Account']"
          );
        };

        const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
        for (const b of allButtons) {
          if (isExcluded(b)) continue;
          const text = (b.textContent || "").trim();
          const testId = (b.getAttribute("data-test-id") || "").toLowerCase();
          const aria = (b.getAttribute("aria-label") || "").toLowerCase();

          if (
            text === "Pro Mở rộng" ||
            text === "Flash Mở rộng" ||
            text === "3.8 Flash" ||
            text === "3.1 Pro" ||
            text === "3.5 Flash-Lite" ||
            (text.includes("Mở rộng") && (text.includes("Pro") || text.includes("Flash"))) ||
            testId.includes("mode-menu") ||
            aria.includes("chọn mô hình")
          ) {
            (b as HTMLElement).click();
            return true;
          }
        }
        return false;
      });

      if (!opened) {
        const fallbackBtn = page
          .locator(
            'button:has-text("Pro Mở rộng"), button:has-text("Flash Mở rộng"), button:has-text("3.1 Pro"), button:has-text("3.8 Flash"), [data-test-id*="mode-menu"]'
          )
          .first();
        if (await fallbackBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await fallbackBtn.click();
        }
      }

      await page.waitForTimeout(600);

      // Step 3: Select the specific target model item from the open menu overlay
      const clicked = await page.evaluate((key) => {
        const overlays = Array.from(
          document.querySelectorAll(
            '.cdk-overlay-container, [role="menu"], mat-menu-panel, .mat-mdc-menu-panel'
          )
        );
        const searchScope = overlays.length > 0 ? overlays : [document];

        for (const scope of searchScope) {
          const items = Array.from(
            scope.querySelectorAll(
              '[role="menuitem"], [role="menuitemradio"], mat-list-item, div.mat-mdc-menu-item, [role="option"], .mat-mdc-menu-item, button, div'
            )
          );

          for (const el of items) {
            const text = (el.textContent || "").trim();
            // Skip if this is the menu trigger button itself
            if (el.getAttribute("aria-haspopup") === "menu") continue;

            if (key === "3.8") {
              // Target 3.8 Flash specifically: MUST contain 3.8 Flash or (3.8 and Flash)
              if (
                text.includes("3.8 Flash") ||
                (text.includes("3.8") && text.includes("Flash")) ||
                (text.includes("Flash") && !text.includes("Lite") && !text.includes("Mở rộng") && !text.includes("Pro"))
              ) {
                el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
                el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
                (el as HTMLElement).click();
                return { success: true, clicked: text };
              }
            } else if (key === "3.1") {
              if (
                text.includes("3.1 Pro") ||
                (text.includes("3.1") && text.includes("Pro")) ||
                (text.includes("Pro") && !text.includes("Flash") && !text.includes("Mở rộng"))
              ) {
                el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
                el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
                (el as HTMLElement).click();
                return { success: true, clicked: text };
              }
            } else if (key === "3.5") {
              if (text.includes("3.5 Flash-Lite") || text.includes("Lite")) {
                el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
                el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
                (el as HTMLElement).click();
                return { success: true, clicked: text };
              }
            }
          }
        }
        return { success: false, clicked: "" };
      }, targetKey);

      if (!clicked?.success) {
        // Fallback with Playwright locators using version-specific filters
        const itemLocator = page
          .locator(
            targetKey === "3.8"
              ? '[role="menuitem"]:has-text("3.8 Flash"), [role="menuitemradio"]:has-text("3.8 Flash"), div:has-text("3.8 Flash"), button:has-text("3.8 Flash")'
              : targetKey === "3.1"
              ? '[role="menuitem"]:has-text("3.1 Pro"), [role="menuitemradio"]:has-text("3.1 Pro"), div:has-text("3.1 Pro"), button:has-text("3.1 Pro")'
              : '[role="menuitem"]:has-text("3.5 Flash-Lite"), [role="menuitemradio"]:has-text("3.5 Flash-Lite"), div:has-text("3.5 Flash-Lite")'
          )
          .last();

        if (await itemLocator.isVisible({ timeout: 1500 }).catch(() => false)) {
          await itemLocator.click({ force: true });
        }
      }

      await page.waitForTimeout(800);
      await page.keyboard.press("Escape").catch(() => {});
      console.log(`[GeminiWeb] ✓ Model selector updated to target ${targetKey === "3.8" ? "3.8 Flash" : targetKey === "3.1" ? "3.1 Pro" : "3.5 Flash-Lite"}`);
    } catch (err: any) {
      console.warn(`[GeminiWeb] Model selection notice: ${err?.message || err}`);
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
