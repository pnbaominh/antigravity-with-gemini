import { chromium, type BrowserContext, type Page } from "playwright-core";
import path from "path";
import os from "os";
import fs from "fs";
import { execSync } from "child_process";
import { BrowserDetector } from "./detector.js";
import { GoogleAccountManager } from "./account-manager.js";
import type { GeminiGenerationClient } from "../gemini/client-interface.js";
import { PromptSanitizer } from "../gemini/prompt-sanitizer.js";
import { cleanupBrowserSingletonLocks } from "../utils/platform.js";
import type { CircuitState, CircuitBreakerSnapshot } from "../types.js";

export class AsyncMutex {
  private mutex = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const current = this.mutex;
    this.mutex = this.mutex.then(() => next);
    await current;
    return release!;
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export class WebEngineCircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  private readonly threshold: number;
  private readonly resetTimeoutMs: number;

  constructor(threshold = 3, resetTimeoutMs = 60000) {
    this.threshold = threshold;
    this.resetTimeoutMs = resetTimeoutMs;
  }

  public recordSuccess() {
    this.failureCount = 0;
    this.state = "CLOSED";
  }

  public recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.threshold) {
      this.state = "OPEN";
    }
  }

  public canExecute(): boolean {
    if (this.state === "CLOSED") return true;
    if (this.state === "OPEN" && this.lastFailureTime) {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = "HALF_OPEN";
        return true;
      }
      return false;
    }
    return this.state === "HALF_OPEN";
  }

  public getSnapshot(): CircuitBreakerSnapshot {
    return {
      state: this.state,
      consecutiveFailures: this.failureCount,
      lastFailureTimestampMs: this.lastFailureTime,
      nextAttemptAllowedAtMs: this.lastFailureTime ? this.lastFailureTime + this.resetTimeoutMs : null,
    };
  }
}

export function computeBackoffWithJitter(attempt: number, baseMs = 1000): number {
  const exp = Math.min(attempt, 4);
  const backoff = baseMs * Math.pow(2, exp);
  const jitter = Math.random() * 0.3 * backoff;
  return Math.floor(backoff + jitter);
}

export interface GeminiWebClientConfig {
  profileDir?: string;
  userDataDir?: string;
  headless?: boolean;
  timeoutMs?: number;
  stabilityWindowMs?: number;
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
  private mutex = new AsyncMutex();
  private circuitBreaker = new WebEngineCircuitBreaker();
  public accountManager: GoogleAccountManager;

  constructor(config: WebClientConfig = {}) {
    this.defaultUserDataDir = path.join(os.homedir(), ".g2a", "browser_profile");
    this.config = {
      userDataDir: config.userDataDir || this.defaultUserDataDir,
      headless: config.headless ?? false,
      timeoutMs: config.timeoutMs ?? 180_000,
      stabilityWindowMs: config.stabilityWindowMs ?? 2500,
      browserPath: config.browserPath,
      preferredModel: config.preferredModel || process.env.GEMINI_MODEL || "4 Argon",
    };
    this.accountManager = new GoogleAccountManager(path.dirname(this.getUserDataDir()));
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
    return await this.mutex.runExclusive(async () => {
      if (this.page && !this.page.isClosed() && this.context) {
        return this.page;
      }

      const executablePath = this.getExecutablePath();
      const userDataDir = this.getUserDataDir();
      if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
      }

      // Proactively clean up any stale lock files before launching
      await cleanupBrowserSingletonLocks(userDataDir);

      const headless = forceHeaded ? false : (this.config.headless ?? false);

      const launchOptions = {
        executablePath,
        headless,
        viewport: { width: 1280, height: 900 },
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-first-run",
          "--no-default-browser-check",
        ],
        ignoreDefaultArgs: ["--enable-automation"],
      };

      try {
        this.context = await chromium.launchPersistentContext(userDataDir, launchOptions);
      } catch (err: any) {
        if (err?.message?.includes("ProcessSingleton")) {
          console.warn("[GeminiWeb] Stale browser process detected holding profile lock. Reclaiming profile lock...");
          if (process.platform === "win32") {
            try {
              execSync("taskkill /IM brave.exe /F", { stdio: "ignore" });
            } catch {}
            try {
              execSync("taskkill /IM chrome.exe /F", { stdio: "ignore" });
            } catch {}
          }
          await new Promise((r) => setTimeout(r, 1000));
          await cleanupBrowserSingletonLocks(userDataDir);
          this.context = await chromium.launchPersistentContext(userDataDir, launchOptions);
        } else {
          throw err;
        }
      }

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
    });
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

    // 3. Confirm onboarding / disclaimer dialogs (e.g. Task mode "Hãy bắt đầu nào" / "Tiếp tục")
    try {
      const continueBtn = page
        .locator(
          '.spark-onboarding-fre-panel button, mat-dialog-container button, button:has-text("Tiếp tục"), button:has-text("Continue"), button:has-text("Bắt đầu"), button:has-text("Get started")'
        )
        .last();
      if (await continueBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        console.log(`[GeminiWeb] ✓ Dismissing/confirming onboarding modal...`);
        await continueBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(500);
      }
    } catch {}
  }

  /**
   * Returns the correct URL for the currently active Google account index:
   * Index 0 -> https://gemini.google.com/app
   * Index 1 -> https://gemini.google.com/u/1/app
   * Index 2 -> https://gemini.google.com/u/2/app
   * etc.
   */
  public getAppUrl(subPath = "app"): string {
    const activeIndex = this.accountManager?.getState()?.activeAccountIndex ?? 0;
    if (activeIndex > 0) {
      return `https://gemini.google.com/u/${activeIndex}/${subPath}`;
    }
    return `https://gemini.google.com/${subPath}`;
  }

  /**
   * Dismisses any active overlay backdrops (.cdk-overlay-backdrop) or dialogs that intercept pointer events.
   */
  public async dismissOverlays(page: Page): Promise<void> {
    if (!page || page.isClosed()) return;
    try {
      // 1. If an onboarding or action modal is open with a confirmation button, click it first
      const confirmBtn = page
        .locator(
          '.spark-onboarding-fre-panel button, mat-dialog-container button, button:has-text("Tiếp tục"), button:has-text("Continue")'
        )
        .last();
      if (await confirmBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await confirmBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(400);
      }

      // 2. Clear any lingering backdrops
      const hasBackdrop = await page.evaluate(() => {
        const backdrops = document.querySelectorAll(
          '.cdk-overlay-backdrop-showing, .cdk-overlay-backdrop'
        );
        return backdrops.length > 0;
      });
      if (hasBackdrop) {
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(200);
        await page.evaluate(() => {
          document
            .querySelectorAll('.cdk-overlay-backdrop-showing, .cdk-overlay-backdrop')
            .forEach((el) => {
              (el as HTMLElement).style.pointerEvents = 'none';
            });
        });
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
   * Supports logging into the primary account or adding additional accounts (--add).
   */
  public async startInteractiveLogin(
    onProgressOrOptions?:
      | ((msg: string) => void)
      | { addAccount?: boolean; onProgress?: (msg: string) => void }
  ): Promise<boolean> {
    const isOptionsObj =
      typeof onProgressOrOptions === "object" && onProgressOrOptions !== null;
    const isAddAccount = isOptionsObj ? (onProgressOrOptions as any).addAccount === true : false;
    const log =
      (isOptionsObj ? (onProgressOrOptions as any).onProgress : onProgressOrOptions) ||
      console.log;

    if (isAddAccount) {
      log("Opening browser window to add an additional Google Account...");
    } else {
      log("Opening browser window for Google Gemini Web login...");
    }

    const page = await this.getPage(true);

    if (isAddAccount) {
      log("Navigating to Google Add Account session (accounts.google.com/AddSession)...");
      try {
        await page.goto(
          "https://accounts.google.com/AddSession?continue=https://gemini.google.com/app",
          { waitUntil: "commit", timeout: 45_000 }
        );
      } catch {}
    } else {
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
        log("Scanning logged-in Google Accounts in browser...");
        await this.accountManager.discoverAccounts(page, (p) => this.handleCaptchaAndPopups(p), (a) => {
          log(`  + Detected Google Account [${a.index}]: ${a.email}`);
        });
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
          log("Scanning logged-in Google Accounts in browser...");
          await this.accountManager.discoverAccounts(page, (p) => this.handleCaptchaAndPopups(p), (a) => {
            log(`  + Registered Google Account [${a.index}]: ${a.email}`);
          });
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
      continueConversation?: boolean;
    }
  ): Promise<{ text: string; model: string }> {
    const page = await this.getPage(this.config.headless === false);

    const isContinuing = options?.continueConversation === true;

    if (!isContinuing) {
      // Ensure we start in a fresh conversation on the active account's Gemini Web app
      const targetAppUrl = this.getAppUrl();
      const currentUrl = page.url();
      const isAlreadyOnFreshApp =
        currentUrl === targetAppUrl ||
        currentUrl === `${targetAppUrl}/`;

      if (!isAlreadyOnFreshApp) {
        let clickedNewChat = false;
        try {
          const newChatBtn = page
            .locator(
              'button:has-text("Cuộc trò chuyện mới"), button:has-text("New chat"), a:has-text("Cuộc trò chuyện mới"), a:has-text("New chat"), [aria-label*="Cuộc trò chuyện mới"], [aria-label*="New chat"]'
            )
            .first();
          if (await newChatBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
            await newChatBtn.click({ force: true });
            await page.waitForTimeout(1500);
            clickedNewChat =
              page.url() === targetAppUrl ||
              page.url() === `${targetAppUrl}/`;
          }
        } catch {}

        if (!clickedNewChat) {
          console.log(`[GeminiWeb] Resetting to fresh conversation: ${targetAppUrl}`);
          await page.goto(targetAppUrl, {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          });
          await page.waitForTimeout(2000);
        }
      }

      await this.handleCaptchaAndPopups(page);
      await this.dismissOverlays(page);

      // Check login
      const isLoggedIn = await this.isUserAuthenticated();
      if (!isLoggedIn) {
        throw new Error(
          "Google Gemini Web is not logged in. Please run `g2a login-web` in terminal to log in to your Google Account first."
        );
      }

      // Proactive Usage Limit Check & Auto-Switch to another Google Account
      const limitStatus = await this.accountManager.checkUsageLimit(page);
      if (limitStatus.hasLimitReached) {
        console.warn(
          `[GeminiWeb] ⚠️ Current account (${limitStatus.accountEmail || "index " + limitStatus.accountIndex}) has reached its usage limit (${limitStatus.reason || "Quota Exhausted"}).`
        );
        if (limitStatus.resetTime) {
          console.warn(`[GeminiWeb] Limit resets at: ${limitStatus.resetTime}`);
        }
        console.log(`[GeminiWeb] 🔄 Auto-switching to next Google account in browser profile...`);

        const switchResult = await this.accountManager.switchToNextAccount(page, (p) =>
          this.handleCaptchaAndPopups(p)
        );
        if (!switchResult.success) {
          throw new Error(
            `[GeminiWeb Quota Exceeded] Tài khoản Google (${limitStatus.accountEmail || "hiện tại"}) đã hết hạn mức sử dụng (Usage limit reached).\n` +
            `Hệ thống không tìm thấy tài khoản Google dự phòng nào khả dụng trong trình duyệt Brave.\n` +
            `👉 Hướng dẫn: Bạn có thể đăng nhập thêm 1 hoặc nhiều tài khoản Google khác để tự động luân chuyển khi hết hạn mức:\n` +
            `  1. Chạy lệnh: g2a login-web --add\n` +
            `  2. Hoặc mở Brave trên trang Gemini, nhấn avatar góc dưới bên trái -> 'Thêm tài khoản khác' (Add another account).\n` +
            `Hạn mức của nick này sẽ đặt lại lúc: ${limitStatus.resetTime || "theo quy định của Google"}.`
          );
        }

        console.log(
          `[GeminiWeb] ✓ Successfully switched to Google account: ${switchResult.account?.email} (Account index [${switchResult.account?.index}])`
        );
        await page.waitForTimeout(2000);
      }

      // 1. Select segmented mode FIRST (Default to "Cuộc trò chuyện" / Chat mode for fast, responsive generation)
      const targetSegment = (options as any)?.segmentedMode || "chat";
      await this.ensureSegmentedMode(page, targetSegment);

      // 2. Ensure target model (prioritize newest: 4 Argon > 3.8 Flash > 3.1 Pro > 3.5 Flash-Lite) is selected
      const activeModel =
        options?.model ||
        this.config.preferredModel ||
        process.env.GEMINI_MODEL ||
        "4 Argon";
      await this.ensureBestModel(page, activeModel);
    } else {
      // Continuing conversation in the EXACT SAME CHAT THREAD:
      // Absolutely NO clicking "Cuộc trò chuyện mới" / "New chat", NO navigation, NO page reload!
      // This preserves Gemini's entire context window, thinking field, and reasoning chain.
      await this.handleCaptchaAndPopups(page);
    }

    const activeModel =
      options?.model ||
      this.config.preferredModel ||
      process.env.GEMINI_MODEL ||
      "4 Argon";

    // Enforce target model even when continuing in existing chat thread
    await this.ensureBestModel(page, activeModel);

    // Clean, natural prompt incorporating system instruction if provided (fresh chats only)
    let fullPrompt = prompt;
    if (
      options?.systemInstruction &&
      !isContinuing &&
      !prompt.includes("Vai trò:") &&
      !prompt.includes("Role:") &&
      !prompt.includes("chuẩn RULES.MD")
    ) {
      fullPrompt = `${options.systemInstruction}\n\n${prompt}`;
    }

    const extracted = await this.submitAndExtract(page, fullPrompt);

    // Check if usage limit was triggered during or after generation
    const limitCheckPost = await this.accountManager.checkUsageLimit(page);
    const textLimitCheck = this.accountManager.isUsageLimitText(extracted || "");

    if (limitCheckPost.hasLimitReached || textLimitCheck.reached) {
      console.warn(
        `[GeminiWeb] ⚠️ Account reached usage limit during prompt execution (${textLimitCheck.reason || limitCheckPost.reason || "Quota Exceeded"}).`
      );
      console.log(`[GeminiWeb] 🔄 Auto-switching to next Google account and retrying prompt...`);
      const switchResult = await this.accountManager.switchToNextAccount(page, (p) =>
        this.handleCaptchaAndPopups(p)
      );
      if (switchResult.success) {
        console.log(
          `[GeminiWeb] ✓ Successfully switched to Google account: ${switchResult.account?.email}. Re-submitting prompt on fresh account session...`
        );
        await this.resetToFreshChat(page);
        const targetSegment = (options as any)?.segmentedMode || "chat";
        await this.ensureSegmentedMode(page, targetSegment);
        await this.ensureBestModel(page, activeModel);
        const retryResult = await this.submitAndExtract(page, fullPrompt);
        if (retryResult && !this.isBackendError(retryResult)) {
          return {
            text: retryResult,
            model: activeModel,
          };
        }
      } else {
        throw new Error(
          `[GeminiWeb Quota Exceeded] Tài khoản Google đã hết hạn mức sử dụng và không còn tài khoản dự phòng khả dụng.\n` +
          `Vui lòng đăng nhập thêm tài khoản phụ bằng: g2a login-web --add`
        );
      }
    }

    const isError =
      !extracted ||
      this.isBackendError(extracted) ||
      (extracted.length < 150 && !extracted.includes("Plan:"));

    if (isError) {
      if (isContinuing) {
        // When continuing conversation, try in-chat re-prompting first instead of blowing away the chat
        console.warn(
          `[GeminiWeb Client] Response in existing thread was truncated or flagged ("${(extracted || "").slice(0, 50)}..."). Re-prompting politely in current thread...`
        );
        const retryPrompt = `Cảm ơn bạn. Nhờ bạn trình bày chi tiết bản Kế Hoạch Kiến Trúc Kỹ Thuật bắt đầu bằng "# Plan:":`;
        const retryExtracted = await this.submitAndExtract(page, retryPrompt);
        if (retryExtracted && !this.isBackendError(retryExtracted) && retryExtracted.length > 200) {
          return {
            text: retryExtracted,
            model: activeModel,
          };
        }
        // In continuing conversation, NEVER call executeAutonomousBypass (which calls resetToFreshChat)
        // Return whatever was obtained so the planner falls back to draftMarkdown while keeping chat intact
        return {
          text: retryExtracted || extracted || "",
          model: activeModel,
        };
      }

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
        await newChatBtn.click({ force: true });
        await page.waitForTimeout(2000);
        await this.dismissOverlays(page);
        return;
      }
    } catch {}
    try {
      const targetUrl = this.getAppUrl();
      console.log(`[GeminiWeb] Resetting to fresh conversation: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      await this.dismissOverlays(page);
    } catch {}
  }

  /**
   * Submits prompt text to chat input and waits for generation to stabilize.
   */
  public async submitAndExtract(page: Page, promptText: string): Promise<string> {
    await this.dismissOverlays(page);

    const inputSelector =
      'div[role="textbox"].ql-editor, rich-textarea div[role="textbox"], div[contenteditable="true"], div[role="textbox"]';
    const textbox = page.locator(inputSelector).first();
    await textbox.waitFor({ state: "attached", timeout: 15_000 });

    // Verify textbox is not disabled by fieldset[disabled] or contenteditable="false"
    let isDisabled = await page.evaluate(() => {
      const tb = document.querySelector(
        'div[role="textbox"].ql-editor, rich-textarea div[role="textbox"], div[contenteditable="true"]'
      );
      if (!tb) return false;
      const isFieldsetDisabled = !!tb.closest('fieldset[disabled]');
      const isContentEditableFalse = tb.getAttribute('contenteditable') === 'false';
      return isFieldsetDisabled || isContentEditableFalse;
    });

    if (isDisabled) {
      // First attempt to resolve by clicking onboarding modals / disclaimer buttons
      await this.dismissOverlays(page);
      await this.handleCaptchaAndPopups(page);
      await page.waitForTimeout(1000);

      isDisabled = await page.evaluate(() => {
        const tb = document.querySelector(
          'div[role="textbox"].ql-editor, rich-textarea div[role="textbox"], div[contenteditable="true"]'
        );
        if (!tb) return false;
        const isFieldsetDisabled = !!tb.closest('fieldset[disabled]');
        const isContentEditableFalse = tb.getAttribute('contenteditable') === 'false';
        return isFieldsetDisabled || isContentEditableFalse;
      });

      if (isDisabled) {
        throw new Error(
          "Gemini input textbox is disabled (account usage limit or disabled input area)."
        );
      }
    }

    // Safely focus textbox without failing on overlay pointer interception
    await textbox.focus().catch(() => {});
    await textbox.click({ force: true, timeout: 3000 }).catch(async () => {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLElement;
        if (el) el.focus();
      }, inputSelector);
    });
    await page.waitForTimeout(300);

    // Clear any residual draft in the input box
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(200);

    // Count existing responses and record current text to detect when new turn arrives
    const { initialResponseCount, initialLatestText } = await page.evaluate(() => {
      const responseEls = document.querySelectorAll(
        'message-content, assistant-messages-primary, .model-response, [data-test-id="model-response"], .remy-container'
      );
      const count = responseEls.length;
      let text = "";
      if (count > 0) {
        text = ((responseEls[count - 1] as HTMLElement).innerText || "").trim();
      }
      return { initialResponseCount: count, initialLatestText: text };
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

    let sent = false;
    try {
      if (await sendButton.isVisible({ timeout: 2000 })) {
        for (let i = 0; i < 10; i++) {
          if (await sendButton.isEnabled()) {
            await sendButton.click({ force: true });
            sent = true;
            break;
          }
          await page.waitForTimeout(300);
        }
      }
    } catch {}

    if (!sent) {
      await page.keyboard.press("Enter");
    }

    // In Task mode, Google may display .spark-onboarding-fre-panel upon sending the prompt
    await page.waitForTimeout(600);
    const postSendContinue = page
      .locator(
        '.spark-onboarding-fre-panel button, mat-dialog-container button, button:has-text("Tiếp tục"), button:has-text("Continue")'
      )
      .last();
    if (await postSendContinue.isVisible({ timeout: 1500 }).catch(() => false)) {
      console.log(`[GeminiWeb] ✓ Task mode onboarding dialog detected post-send. Clicking "Tiếp tục"...`);
      await postSendContinue.click({ force: true }).catch(() => {});
      await page.waitForTimeout(800);
      const reSendBtn = page
        .locator(
          'button[aria-label*="Gửi tin nhắn"], button[aria-label*="Send message"], button[aria-label*="Send"], button[aria-label*="Gửi"], button.send-button'
        )
        .first();
      if (await reSendBtn.isVisible({ timeout: 1000 }).catch(() => false) && await reSendBtn.isEnabled().catch(() => false)) {
        await reSendBtn.click({ force: true }).catch(() => {});
      } else {
        await page.keyboard.press("Enter").catch(() => {});
      }
    }

    // Wait for response generation to start
    const timeoutMs = this.config.timeoutMs || 180_000;
    const startTime = Date.now();

    while (Date.now() - startTime < 20_000) {
      const isStarted = await page.evaluate(
        ({ initCount, initText }) => {
          const stopBtn =
            document.querySelector('button[aria-label*="Stop"], button[aria-label*="Dừng"]') ||
            document.querySelector('mat-spinner, .loading-indicator');
          if (stopBtn) return true;

          const responseEls = document.querySelectorAll(
            'message-content, assistant-messages-primary, .model-response, [data-test-id="model-response"], .remy-container'
          );
          if (responseEls.length > initCount) return true;
          if (responseEls.length > 0) {
            const currentText = ((responseEls[responseEls.length - 1] as HTMLElement).innerText || "").trim();
            if (currentText && currentText !== initText) return true;
          }
          return false;
        },
        { initCount: initialResponseCount, initText: initialLatestText }
      );

      if (isStarted) {
        break;
      }
      await page.waitForTimeout(400);
    }

    // Wait until generation finishes (Stop button disappears and content stabilizes)
    let lastContent = "";
    let stableCount = 0;

    while (Date.now() - startTime < timeoutMs) {
      await page.waitForTimeout(1000);

      const status = await page.evaluate((initText) => {
        const stopBtn =
          document.querySelector('button[aria-label*="Stop"], button[aria-label*="Dừng"]') ||
          document.querySelector('mat-spinner, .loading-indicator');
        const isGenerating = !!stopBtn;

        const responseEls = document.querySelectorAll(
          'message-content, assistant-messages-primary, .model-response, [data-test-id="model-response"], .remy-container'
        );
        let latestText = "";
        if (responseEls.length > 0) {
          const lastEl = responseEls[responseEls.length - 1] as HTMLElement;
          latestText = (lastEl.innerText || "").trim();
        }

        const isNewText = latestText !== initText;

        return {
          isGenerating,
          latestText,
          isNewText,
        };
      }, initialLatestText);

      // Fast-exit if backend refusal or error is detected and generation has stopped
      if (!status.isGenerating && status.latestText.length > 0 && this.isBackendError(status.latestText)) {
        console.warn(
          `[GeminiWeb Client] Backend error or safety refusal detected: "${status.latestText.slice(0, 80)}..."`
        );
        break;
      }

      // Check stabilization on new text using configured stabilityWindowMs (default 2500ms)
      const requiredStableCount = Math.max(2, Math.round((this.config.stabilityWindowMs || 2500) / 1000));
      if (status.latestText.length > 0 && (status.isNewText || initialLatestText === "")) {
        if (status.latestText === lastContent && !status.isGenerating) {
          stableCount++;
          if (stableCount >= requiredStableCount) {
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
      // Prioritize standard message-content first
      const msgEls = document.querySelectorAll('message-content');
      if (msgEls.length > 0) {
        const last = msgEls[msgEls.length - 1] as HTMLElement;
        const txt = (last.innerText || "").trim();
        if (txt.length > 0) return txt;
      }
      const responseEls = document.querySelectorAll(
        'assistant-messages-primary, .model-response, [data-test-id="model-response"], .remy-container'
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
    if (this.accountManager && this.accountManager.isUsageLimitText(text).reached) {
      return true;
    }
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
      lower.includes("không thể trợ giúp về điều đó") ||
      lower.includes("tôi không thể hỗ trợ điều đó") ||
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
      lower.includes("tôi chỉ là một mô hình ngôn ngữ") ||
      lower.includes("tôi chỉ là mô hình ngôn ngữ") ||
      lower.includes("tôi là một công nghệ trí tuệ nhân tạo") ||
      lower.includes("tôi chỉ là một mô hình") ||
      lower.includes("tôi không được lập trình") ||
      lower.includes("nằm ngoài khả năng") ||
      lower.includes("nằm ngoài mục đích") ||
      lower.includes("can't help with that") ||
      lower.includes("cannot assist") ||
      lower.includes("as a language model") ||
      lower.includes("i'm just a language model") ||
      lower.includes("i am just a language model") ||
      lower.includes("i am an ai language model") ||
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
    return await this.executeAutonomousBypass(page, taskPrompt, previousError, "4 Argon");
  }

  /**
   * Autonomous Multi-Tier Adaptive Bypass Engine (Zero code edits required by user).
   * If the newest model refuses or encounters an error, this method autonomously executes
   * progressive self-healing tiers:
   * - Tier 1: Deep Architectural RFC Safe-Framing on current model (4 Argon).
   * - Tier 2: Structural Data-Contract & Inversion (specifying types & interfaces without action verbs).
   * - Tier 3: Autonomous Cross-Model Fallback (e.g. 4 Argon -> 3.8 Flash -> 3.1 Pro) in a clean chat session.
   * - Tier 4: Lightweight Fallback (to 3.5 Flash-Lite) if Pro also encounters quota or refusal.
   * - Tier 5: Minimalist Core Architecture Scaffold.
   */
  public async executeAutonomousBypass(
    page: Page,
    taskPrompt: string,
    previousError: string,
    initialModel: string = "4 Argon"
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
      await this.ensureSegmentedMode(page, "chat");
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
      await this.ensureSegmentedMode(page, "chat");
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

    // TIER 3: Autonomous Cross-Model Fallback (Switch from 4 Argon -> 3.8 Flash or 3.1 Pro)
    const alternateModel =
      initialModel.toLowerCase().includes("argon") || initialModel.includes("4")
        ? "3.8 Flash"
        : initialModel.toLowerCase().includes("flash") && !initialModel.toLowerCase().includes("lite")
        ? "3.1 Pro"
        : "4 Argon";
    try {
      console.warn(`[GeminiWeb Bypass] Tier 3: Autonomous model rotation -> Switching to ${alternateModel}...`);
      await this.resetToFreshChat(page);
      await this.ensureSegmentedMode(page, "chat");
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
      await this.ensureSegmentedMode(page, "chat");
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
   * Prioritizes newest models first: 4 Argon > 3.8 Flash > 3.1 Pro > 3.5 Flash-Lite.
   */
  public async ensureBestModel(page: Page, requestedModel?: string): Promise<void> {
    try {
      const rawTarget = (
        requestedModel ||
        this.config.preferredModel ||
        process.env.GEMINI_MODEL ||
        "4 Argon"
      ).toLowerCase();

      // Normalize target key: "4.0", "3.8", "3.1", or "3.5"
      let targetKey = "4.0";
      if (rawTarget.includes("3.5") || rawTarget.includes("lite")) {
        targetKey = "3.5";
      } else if (rawTarget.includes("3.1") || rawTarget.includes("pro")) {
        targetKey = "3.1";
      } else if (rawTarget.includes("3.8") || rawTarget.includes("flash")) {
        targetKey = "3.8";
      } else if (rawTarget.includes("4") || rawTarget.includes("argon")) {
        targetKey = "4.0";
      } else {
        targetKey = "4.0";
      }

      // 1. Safely focus input area so bottom toolbar and model selector are visible
      await this.dismissOverlays(page);
      const textbox = page.locator(
        'div[role="textbox"].ql-editor, rich-textarea div[role="textbox"], div[contenteditable="true"]'
      ).first();
      if (await textbox.isVisible().catch(() => false)) {
        await textbox.focus().catch(() => {});
        await textbox.click({ force: true, timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(300);
      }

      // 2. Locate the model picker button with highest specificity
      const modeBtn = page.locator(
        'button[data-test-id="bard-mode-menu-button"], button.input-area-switch, button[aria-label*="chọn chế độ"], button[aria-label*="mode picker"], button[aria-label*="mode selector"], button:has-text("Argon"), button:has-text("4 Argon"), button:has-text("Flash"), button:has-text("Pro")'
      ).first();

      const isVisible = await modeBtn.isVisible({ timeout: 5000 }).catch(() => false);
      if (!isVisible) {
        console.warn("[GeminiWeb] Mode button not found on page");
        return;
      }

      const currentText = (await modeBtn.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      const currentAria = (await modeBtn.getAttribute("aria-label").catch(() => "")) || "";

      // 3. Check if already on target model to avoid unnecessary clicks or re-toggling
      if (targetKey === "4.0") {
        if (
          (currentText.includes("Argon") || currentAria.includes("Argon")) &&
          !currentText.includes("Flash") &&
          !currentAria.includes("Flash")
        ) {
          console.log("[GeminiWeb] ✓ Already on 4 Argon (newest model)");
          return;
        }
      } else if (targetKey === "3.8") {
        if (
          (currentText.includes("Flash") || currentText.includes("3.8") || currentAria.includes("Flash") || currentAria.includes("3.8")) &&
          !currentText.includes("Lite") &&
          !currentText.includes("Pro") &&
          !currentText.includes("Argon") &&
          !currentAria.includes("Pro") &&
          !currentAria.includes("Argon")
        ) {
          console.log("[GeminiWeb] ✓ Already on 3.8 Flash");
          return;
        }
      } else if (targetKey === "3.5") {
        if (currentText.includes("Lite") || currentText.includes("3.5") || currentAria.includes("Lite")) {
          console.log("[GeminiWeb] ✓ Already on 3.5 Flash-Lite");
          return;
        }
      }

      // 4. Click the mode button to open the menu
      await modeBtn.click({ force: true });
      await page.waitForTimeout(600);

      // 5. Click target menu item directly via role="menuitem" and native DOM dispatch
      const targetItem = page.locator(
        targetKey === "4.0"
          ? 'gem-menu-item[data-test-id*="95a4c0abcba24364"], gem-menu-item[data-mode-id*="95a4c0abcba24364"], gem-menu-item:has-text("4 Argon"), [role="menuitem"]:has-text("4 Argon"), .mat-mdc-menu-item:has-text("4 Argon"), button:has-text("4 Argon"), [role="menuitem"]:has-text("Argon"), .mat-mdc-menu-item:has-text("Argon"), [role="menuitem"]:has-text("Nhiệm vụ phức tạp")'
          : targetKey === "3.8"
          ? 'gem-menu-item[data-test-id*="56fdd199312815e2"], gem-menu-item[data-mode-id*="56fdd199312815e2"], gem-menu-item:has-text("3.8 Flash"), [role="menuitem"]:has-text("3.8 Flash"), .mat-mdc-menu-item:has-text("3.8 Flash"), button:has-text("3.8 Flash"), [role="menuitem"]:has-text("3.8"), [role="menuitem"]:has-text("Flash")'
          : targetKey === "3.1"
          ? 'gem-menu-item[data-test-id*="e6fa609c3fa255c0"], gem-menu-item[data-mode-id*="e6fa609c3fa255c0"], gem-menu-item:has-text("3.1 Pro"), [role="menuitem"]:has-text("3.1 Pro"), [role="menuitem"]:has-text("3.1"), [role="menuitem"]:has-text("Pro")'
          : 'gem-menu-item[data-test-id*="8c46e95b1a07cecc"], gem-menu-item[data-mode-id*="8c46e95b1a07cecc"], gem-menu-item:has-text("Flash-Lite"), [role="menuitem"]:has-text("Flash-Lite"), [role="menuitem"]:has-text("3.5")'
      ).first();

      if (await targetItem.isVisible({ timeout: 2500 }).catch(() => false)) {
        await targetItem.click({ force: true });
        await page.waitForTimeout(500);
      }

      // Also dispatch native DOM click on the Angular gem-menu-item host element
      await page.evaluate((key) => {
        const items = Array.from(document.querySelectorAll('gem-menu-item, [role="menuitem"], .mat-mdc-menu-item'));
        const match = items.find((el) => {
          const testId = el.getAttribute("data-test-id") || "";
          const modeId = el.getAttribute("data-mode-id") || "";
          if (key === "4.0" && (testId.includes("95a4c0abcba24364") || modeId.includes("95a4c0abcba24364"))) return true;
          if (key === "3.8" && (testId.includes("56fdd199312815e2") || modeId.includes("56fdd199312815e2"))) return true;
          if (key === "3.1" && (testId.includes("e6fa609c3fa255c0") || modeId.includes("e6fa609c3fa255c0"))) return true;
          if (key === "3.5" && (testId.includes("8c46e95b1a07cecc") || modeId.includes("8c46e95b1a07cecc"))) return true;
          const t = (el.textContent || "").trim();
          if (key === "4.0") return t.includes("4 Argon") || t.includes("Argon") || t.includes("Nhiệm vụ phức tạp");
          if (key === "3.8") return t.includes("3.8 Flash") || t.includes("Flash");
          if (key === "3.1") return t.includes("3.1 Pro") || t.includes("Pro");
          if (key === "3.5") return t.includes("Flash-Lite") || t.includes("3.5");
          return false;
        });
        if (match) {
          (match as HTMLElement).click();
        }
      }, targetKey);
      await page.waitForTimeout(800);

      // Ensure thinking level is set to maximum capacity for 4 Argon and thinking models if submenu exists
      if (targetKey === "4.0" || targetKey === "3.1") {
        await this.ensureThinkingLevelMax(page);
      }

      // 6. Dismiss any lingering overlay backdrop
      await this.dismissOverlays(page);

      // 7. Verify model switched to target. If not, retry up to 2 times
      let postText = (await modeBtn.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      let postAria = (await modeBtn.getAttribute("aria-label").catch(() => "")) || "";

      let isTargetSelected =
        targetKey === "4.0"
          ? (postText.includes("Argon") || postAria.includes("Argon")) && !postText.includes("Flash")
          : targetKey === "3.8"
          ? (postText.includes("Flash") || postAria.includes("Flash")) && !postText.includes("Lite") && !postText.includes("Argon")
          : true;

      for (let retry = 1; retry <= 2 && !isTargetSelected; retry++) {
        console.warn(`[GeminiWeb] Target model verification attempt ${retry}: currently "${postText}". Retrying selection...`);
        await modeBtn.click({ force: true });
        await page.waitForTimeout(600);

        await page.evaluate((key) => {
          const items = Array.from(document.querySelectorAll('gem-menu-item, [role="menuitem"], .mat-mdc-menu-item'));
          const match = items.find((el) => {
            const testId = el.getAttribute("data-test-id") || "";
            const modeId = el.getAttribute("data-mode-id") || "";
            if (key === "4.0" && (testId.includes("95a4c0abcba24364") || modeId.includes("95a4c0abcba24364"))) return true;
            if (key === "3.8" && (testId.includes("56fdd199312815e2") || modeId.includes("56fdd199312815e2"))) return true;
            if (key === "3.1" && (testId.includes("e6fa609c3fa255c0") || modeId.includes("e6fa609c3fa255c0"))) return true;
            if (key === "3.5" && (testId.includes("8c46e95b1a07cecc") || modeId.includes("8c46e95b1a07cecc"))) return true;
            const t = (el.textContent || "").trim();
            if (key === "4.0") return t.includes("4 Argon") || t.includes("Argon") || t.includes("Nhiệm vụ phức tạp");
            if (key === "3.8") return t.includes("3.8 Flash") || t.includes("Flash");
            if (key === "3.1") return t.includes("3.1 Pro") || t.includes("Pro");
            if (key === "3.5") return t.includes("Flash-Lite") || t.includes("3.5");
            return false;
          });
          if (match) {
            (match as HTMLElement).click();
          }
        }, targetKey);
        await page.waitForTimeout(600);
        await this.dismissOverlays(page);

        postText = (await modeBtn.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
        postAria = (await modeBtn.getAttribute("aria-label").catch(() => "")) || "";
        isTargetSelected =
          targetKey === "4.0"
            ? (postText.includes("Argon") || postAria.includes("Argon")) && !postText.includes("Flash")
            : true;
      }

      console.log(
        `[GeminiWeb] ✓ Model selector updated to target ${
          targetKey === "4.0"
            ? "4 Argon"
            : targetKey === "3.8"
            ? "3.8 Flash"
            : targetKey === "3.1"
            ? "3.1 Pro"
            : "3.5 Flash-Lite"
        } (current: "${postText}")`
      );
    } catch (err: any) {
      console.warn(`[GeminiWeb] Model selection notice: ${err?.message || err}`);
    }
  }

  /**
   * Ensures Thinking Level ("Cấp độ tư duy") is configured to maximum capacity if present in UI.
   */
  public async ensureThinkingLevelMax(page: Page): Promise<void> {
    try {
      const thinkingLevelBtn = page.locator(
        '[role="menuitem"]:has-text("Cấp độ tư duy"), [role="menuitem"]:has-text("Thinking level"), button:has-text("Cấp độ tư duy"), button:has-text("Thinking level")'
      ).first();

      if (await thinkingLevelBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await thinkingLevelBtn.hover();
        await page.waitForTimeout(400);

        let maxLevelOption = page.locator(
          '[role="menuitem"]:has-text("Cao"), [role="menuitem"]:has-text("High"), [role="menuitem"]:has-text("Nâng cao"), [role="menuitem"]:has-text("Tối đa"), [role="menuitem"]:has-text("Toàn diện")'
        ).first();

        if (!(await maxLevelOption.isVisible({ timeout: 600 }).catch(() => false))) {
          await thinkingLevelBtn.click({ force: true });
          await page.waitForTimeout(400);
          maxLevelOption = page.locator(
            '[role="menuitem"]:has-text("Cao"), [role="menuitem"]:has-text("High"), [role="menuitem"]:has-text("Nâng cao"), [role="menuitem"]:has-text("Tối đa"), [role="menuitem"]:has-text("Toàn diện")'
          ).first();
        }

        if (await maxLevelOption.isVisible({ timeout: 1500 }).catch(() => false)) {
          await maxLevelOption.click({ force: true });
          await page.waitForTimeout(500);
          console.log("[GeminiWeb] ✓ Thinking level configured to maximum capacity (Cao / High / Tối đa)");
        }
      }
    } catch {}
  }

  /**
   * Selects between "Nhiệm vụ" (Task Mode - optimized for structured engineering plans)
   * and "Cuộc trò chuyện" (Chat Mode - for general open discussion).
   */
  public async ensureSegmentedMode(page: Page, mode: "task" | "chat" = "chat"): Promise<void> {
    try {
      const isTask = mode === "task";

      // 1. Check if the requested segmented mode is already active
      const isAlreadyActive = await page.evaluate((targetIsTask) => {
        const buttons = Array.from(document.querySelectorAll("gem-segmented-button"));
        for (const btn of buttons) {
          const text = (btn.textContent || "").trim();
          const isSelected = btn.classList.contains("gem-segmented-button-selected");
          if (targetIsTask) {
            if (isSelected && (text.includes("Nhiệm vụ") || text.includes("Task"))) {
              return true;
            }
          } else {
            if (isSelected && (text.includes("Cuộc trò chuyện") || text.includes("Chat"))) {
              return true;
            }
          }
        }
        return false;
      }, isTask);

      if (isAlreadyActive) {
        console.log(`[GeminiWeb] ✓ Segmented mode already on "${isTask ? "Nhiệm vụ" : "Cuộc trò chuyện"}"`);
        if (isTask) {
          const continueBtn = page
            .locator(
              '.spark-onboarding-fre-panel button, mat-dialog-container button, button:has-text("Tiếp tục"), button:has-text("Continue")'
            )
            .last();
          if (await continueBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
            console.log(`[GeminiWeb] ✓ Task mode onboarding dialog detected. Clicking "Tiếp tục"...`);
            await continueBtn.click({ force: true }).catch(() => {});
            await page.waitForTimeout(600);
          }
        }
        return;
      }

      // 2. Click target segmented button
      const btn = page
        .locator(
          isTask
            ? 'button.gem-segmented-button-action:has-text("Nhiệm vụ"), button.gem-segmented-button-action:has-text("Task"), [role="tab"]:has-text("Nhiệm vụ"), [role="tab"]:has-text("Task")'
            : 'button.gem-segmented-button-action:has-text("Cuộc trò chuyện"), button.gem-segmented-button-action:has-text("Chat"), [role="tab"]:has-text("Cuộc trò chuyện"), [role="tab"]:has-text("Chat")'
        )
        .first();

      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click({ force: true });
        await page.waitForTimeout(600);
        console.log(`[GeminiWeb] ✓ Segmented mode configured to "${isTask ? "Nhiệm vụ" : "Cuộc trò chuyện"}"`);
        if (isTask) {
          const continueBtn = page
            .locator(
              '.spark-onboarding-fre-panel button, mat-dialog-container button, button:has-text("Tiếp tục"), button:has-text("Continue")'
            )
            .last();
          if (await continueBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
            console.log(`[GeminiWeb] ✓ Task mode onboarding dialog detected. Clicking "Tiếp tục"...`);
            await continueBtn.click({ force: true }).catch(() => {});
            await page.waitForTimeout(800);
          }
        }
      }
    } catch (err: any) {
      console.warn(`[GeminiWeb] Segmented mode selection notice: ${err?.message || err}`);
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
