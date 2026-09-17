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
    return this.page;
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

    // Wait a brief moment for redirects or UI rendering
    await page.waitForTimeout(3000);
    const url = page.url();

    // If redirected to Google login or accounts page
    if (url.includes("accounts.google.com") || url.includes("/signin")) {
      return false;
    }

    // Check for presence of chat input or conversation container
    const hasInput = await page.evaluate(() => {
      const input =
        document.querySelector('rich-textarea div[role="textbox"]') ||
        document.querySelector('div[contenteditable="true"]') ||
        document.querySelector('div[role="textbox"]');
      return !!input;
    });

    return hasInput;
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
    await page.goto("https://gemini.google.com/app", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    log("Please log in to your Google Account in the opened browser window if prompted.");

    // Poll until login is complete (user lands on gemini chat screen)
    const startTime = Date.now();
    const maxWait = 5 * 60 * 1000; // 5 minutes

    while (Date.now() - startTime < maxWait) {
      await page.waitForTimeout(2000);
      const url = page.url();
      if (!url.includes("accounts.google.com")) {
        const hasInput = await page.evaluate(() => {
          const input =
            document.querySelector('rich-textarea div[role="textbox"]') ||
            document.querySelector('div[contenteditable="true"]') ||
            document.querySelector('div[role="textbox"]');
          return !!input;
        });

        if (hasInput) {
          log("✓ Google Gemini Web session detected and active!");
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

    // Check login
    const isLoggedIn = await page.evaluate(() => {
      return !!(
        document.querySelector('rich-textarea div[role="textbox"]') ||
        document.querySelector('div[contenteditable="true"]') ||
        document.querySelector('div[role="textbox"]')
      );
    });

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
    const inputSelector = 'rich-textarea div[role="textbox"], div[contenteditable="true"], div[role="textbox"]';
    await page.waitForSelector(inputSelector, { timeout: 15_000 });

    // Focus input element
    await page.click(inputSelector);

    // Count existing responses to detect when new response arrives
    const initialResponseCount = await page.evaluate(() => {
      return document.querySelectorAll('message-content, .model-response, [data-test-id="model-response"]').length;
    });

    // 2. Inject text into input element
    // Using evaluate + input event for fast, instantaneous pasting of long prompts
    await page.evaluate(
      ({ selector, text }) => {
        const el = document.querySelector(selector) as HTMLElement;
        if (el) {
          el.focus();
          // Clear previous text
          el.innerText = text;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      },
      { selector: inputSelector, text: fullPrompt }
    );

    // Brief pause to let frontend state update
    await page.waitForTimeout(500);

    // 3. Click Send button or press Enter
    const sendButtonSelector =
      'button[aria-label*="Send"], button[aria-label*="Gửi"], button.send-button, [data-test-id="send-button"]';
    const hasSendBtn = await page.$(sendButtonSelector);

    if (hasSendBtn) {
      await hasSendBtn.click();
    } else {
      await page.keyboard.press("Enter");
    }

    // 4. Wait for response generation to complete
    const timeoutMs = this.config.timeoutMs || 180_000;
    const startTime = Date.now();

    // Wait until response count increments
    while (Date.now() - startTime < 15_000) {
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
      await page.waitForTimeout(1000);

      const status = await page.evaluate(() => {
        // Look for stop button or active spinners
        const stopBtn =
          document.querySelector('button[aria-label*="Stop"], button[aria-label*="Dừng"]') ||
          document.querySelector('mat-spinner, .loading-indicator, .thinking-indicator');
        const isGenerating = !!stopBtn;

        // Get latest response text
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

      if (!status.isGenerating) {
        if (status.latestText && status.latestText === lastContent) {
          stableCount++;
          if (stableCount >= 2) {
            // Content has finished streaming and remained stable for 2 seconds
            break;
          }
        } else {
          stableCount = 0;
          lastContent = status.latestText;
        }
      } else {
        stableCount = 0;
        lastContent = status.latestText;
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
