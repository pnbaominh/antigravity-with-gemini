import { chromium, type BrowserContext, type Page } from "playwright-core";
import path from "path";
import os from "os";
import fs from "fs";
import { BrowserDetector } from "./detector.js";
import type { GeminiGenerationClient } from "../gemini/client-interface.js";

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

    // If not already on Gemini Web, navigate there
    if (!page.url().includes("gemini.google.com")) {
      await page.goto("https://gemini.google.com/app", {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await page.waitForTimeout(2000);
    }

    await this.handleCaptchaAndPopups(page);

    // Check login
    const isLoggedIn = await this.isUserAuthenticated();
    if (!isLoggedIn) {
      throw new Error(
        "Google Gemini Web is not logged in. Please run `g2a login-web` in terminal to log in to your Google Account first."
      );
    }

    // Full prompt incorporating system instruction if provided
    let fullPrompt = prompt;
    if (options?.systemInstruction) {
      fullPrompt = `[System Directives]\n${options.systemInstruction}\n\n[User Task]\n${prompt}`;
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
        'button[aria-label*="Send"], button[aria-label*="Gửi"], button.send-button, [data-test-id="send-button"]'
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
          if (stableCount >= 2) {
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

    if (
      extracted.includes("I encountered an error doing what you asked") ||
      extracted.includes("Tôi đã gặp lỗi khi thực hiện")
    ) {
      throw new Error(`Gemini Web responded with backend error: "${extracted}"`);
    }

    return {
      text: extracted,
      model: "gemini-web",
    };
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
