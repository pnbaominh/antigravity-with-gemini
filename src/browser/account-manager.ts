import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Page } from "playwright-core";
import type {
  GoogleAccountInfo,
  UsageLimitStatus,
  AccountPoolState,
} from "../types.js";

export const USAGE_LIMIT_KEYWORDS = [
  "bạn đã đạt đến hạn mức",
  "đạt đến hạn mức sử dụng",
  "hạn mức của bạn sẽ được đặt lại",
  "nâng cấp để có hạn mức cao hơn",
  "bạn sẽ có thể tiếp tục thực hiện các nhiệm vụ lúc",
  "đã dùng hết hạn mức",
  "đạt giới hạn yêu cầu",
  "you've reached your current usage limit",
  "you have reached your current usage limit",
  "you've reached your usage limit",
  "you have reached your limit",
  "rate limit reached",
  "usage limit reached",
  "your limit will reset",
  "quota exceeded",
];

export class GoogleAccountManager {
  private stateFilePath: string;
  private state: AccountPoolState;

  constructor(customStateDir?: string) {
    const baseDir = customStateDir || path.join(os.homedir(), ".g2a");
    if (!fs.existsSync(baseDir)) {
      try {
        fs.mkdirSync(baseDir, { recursive: true });
      } catch {}
    }
    this.stateFilePath = path.join(baseDir, "accounts.json");
    this.state = this.loadState();
  }

  public getState(): AccountPoolState {
    return { ...this.state };
  }

  public loadState(): AccountPoolState {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const raw = fs.readFileSync(this.stateFilePath, "utf-8");
        const parsed = JSON.parse(raw);
        return {
          activeAccountIndex: typeof parsed.activeAccountIndex === "number" ? parsed.activeAccountIndex : 0,
          accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
        };
      }
    } catch {
      // Fallback to fresh state
    }
    return {
      activeAccountIndex: 0,
      accounts: [],
    };
  }

  public saveState(): void {
    try {
      fs.writeFileSync(this.stateFilePath, JSON.stringify(this.state, null, 2), "utf-8");
    } catch (err: any) {
      console.warn(`[AccountManager] Notice: Could not save accounts.json: ${err?.message || err}`);
    }
  }

  /**
   * Parses Google Account details (name, email) from avatar aria-label or text.
   */
  public parseAccountFromAria(aria: string, url = ""): Partial<GoogleAccountInfo> | null {
    if (!aria) return null;

    // Pattern: "Tài khoản Google: minh bao (baominh201208@gmail.com)" or "Google Account: Name (email@...)"
    const emailMatch = aria.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (!emailMatch) return null;

    const email = emailMatch[1].trim().toLowerCase();

    // Extract name
    let name: string | undefined;
    const nameMatch = aria.match(/(?:Tài khoản Google|Google Account):\s*([^(]+?)(?:\s*\(|,|$)/i);
    if (nameMatch) {
      name = nameMatch[1].replace(/\n/g, " ").trim();
    }

    // Extract authuser index from url
    let index = 0;
    const uMatch = url.match(/\/u\/(\d+)/i);
    const authUserMatch = url.match(/[?&]authuser=(\d+)/i);
    if (uMatch) {
      index = parseInt(uMatch[1], 10);
    } else if (authUserMatch) {
      index = parseInt(authUserMatch[1], 10);
    }

    return {
      index,
      email,
      name,
    };
  }

  /**
   * Checks whether the given text indicates that the usage limit / quota has been exhausted.
   */
  public isUsageLimitText(text: string): { reached: boolean; reason?: string; resetTime?: string } {
    if (!text) return { reached: false };
    const lower = text.toLowerCase();

    for (const kw of USAGE_LIMIT_KEYWORDS) {
      if (lower.includes(kw)) {
        // Try extracting reset time from surrounding text
        let resetTime = "";
        const resetMatch = text.match(
          /(?:tiếp tục thực hiện các nhiệm vụ lúc|đặt lại vào|reset on|reset at)\s+([^\n.]+?)(?:\s+hoặc|\.|\n|$)/i
        );
        if (resetMatch) {
          resetTime = resetMatch[1].trim();
        }
        return {
          reached: true,
          reason: kw,
          resetTime: resetTime || undefined,
        };
      }
    }

    return { reached: false };
  }

  /**
   * Inspects current Gemini Web page to evaluate if the active account has reached its usage limit.
   */
  public async checkUsageLimit(page: Page): Promise<UsageLimitStatus> {
    if (!page || page.isClosed()) {
      return { hasLimitReached: false };
    }

    const currentUrl = page.url();

    const evaluation = await page.evaluate((keywords) => {
      const bodyText = document.body ? document.body.innerText || "" : "";
      const lower = bodyText.toLowerCase();

      let matchedKeyword: string | undefined;
      for (const kw of keywords) {
        if (lower.includes(kw)) {
          matchedKeyword = kw;
          break;
        }
      }

      // Check for buttons "Xem mức sử dụng" & "Nâng cấp" appearing together in limit card
      const hasLimitCard = !!(
        (lower.includes("xem mức sử dụng") || lower.includes("view usage")) &&
        (lower.includes("nâng cấp") || lower.includes("upgrade")) &&
        (lower.includes("hạn mức") || lower.includes("limit"))
      );

      // Check if input area is disabled (fieldset[disabled] or contenteditable="false")
      const hasDisabledInput = !!document.querySelector(
        'fieldset[disabled] div[role="textbox"], fieldset[disabled] .ql-editor, .input-area-fieldset[disabled], div[role="textbox"][contenteditable="false"]'
      );

      // Extract reset time if available
      let resetTime = "";
      const resetMatch = bodyText.match(
        /(?:tiếp tục thực hiện các nhiệm vụ lúc|đặt lại vào|reset on|reset at)\s+([^\n.]+?)(?:\s+hoặc|\.|\n|$)/i
      );
      if (resetMatch) {
        resetTime = resetMatch[1].trim();
      }

      // Extract account avatar element info
      const all = Array.from(
        document.querySelectorAll(
          'a, button, [role="button"], div.mavatar-footer-left, a.mavatar-footer-left, .mavatar-footer-left'
        )
      );
      const avatarEl =
        all.find((el) => {
          const aria = (el.getAttribute("aria-label") || "").trim();
          const lower = aria.toLowerCase();
          return (
            aria.includes("@") &&
            (lower.includes("tài khoản") ||
              lower.includes("account") ||
              aria.includes("("))
          );
        }) ||
        all.find((el) => {
          const aria = (el.getAttribute("aria-label") || "").toLowerCase();
          return (
            aria.includes("tài khoản google") ||
            aria.includes("google account") ||
            aria.includes("tài khoản ai")
          );
        }) ||
        document.querySelector("a.mavatar-footer-left, .mavatar-footer-left");

      const ariaLabel = avatarEl?.getAttribute("aria-label") || "";
      const innerText = (avatarEl as HTMLElement)?.innerText || "";

      const hasLimit =
        !!matchedKeyword ||
        hasLimitCard ||
        (hasDisabledInput &&
          (lower.includes("hạn mức") ||
            lower.includes("limit") ||
            lower.includes("nhiệm vụ") ||
            lower.includes("nâng cấp")));

      return {
        hasLimit,
        reason:
          matchedKeyword ||
          (hasLimitCard
            ? "usage_limit_banner"
            : hasDisabledInput
            ? "disabled_input_area"
            : undefined),
        resetTime,
        ariaLabel,
        innerText,
      };
    }, USAGE_LIMIT_KEYWORDS);

    // Parse current account
    const parsed = this.parseAccountFromAria(evaluation.ariaLabel, currentUrl);
    const accountEmail = parsed?.email;
    const accountIndex = parsed?.index ?? this.state.activeAccountIndex;

    // Detect plan badge (e.g. Pro, Ultra)
    let plan: string | undefined;
    if (evaluation.innerText.includes("Pro")) {
      plan = "Pro";
    } else if (evaluation.innerText.includes("Ultra")) {
      plan = "Ultra";
    } else if (evaluation.innerText.includes("Advanced")) {
      plan = "Advanced";
    }

    // Register / update current account in state
    if (accountEmail) {
      this.upsertAccount({
        index: accountIndex,
        email: accountEmail,
        name: parsed?.name,
        plan,
        hasLimitReached: evaluation.hasLimit,
        resetTime: evaluation.resetTime || null,
        lastCheckedMs: Date.now(),
      });
      this.state.activeAccountIndex = accountIndex;
      this.saveState();
    }

    return {
      hasLimitReached: evaluation.hasLimit,
      accountEmail,
      accountIndex,
      resetTime: evaluation.resetTime || undefined,
      reason: evaluation.reason,
    };
  }

  /**
   * Reads current active account from page without modifying limits.
   */
  public async getCurrentAccount(page: Page): Promise<GoogleAccountInfo | null> {
    if (!page || page.isClosed()) return null;

    const currentUrl = page.url();
    const avatarInfo = await page.evaluate(() => {
      const all = Array.from(
        document.querySelectorAll(
          'a, button, [role="button"], div.mavatar-footer-left, a.mavatar-footer-left, .mavatar-footer-left'
        )
      );
      const avatarEl =
        all.find((el) => {
          const aria = (el.getAttribute("aria-label") || "").trim();
          const lower = aria.toLowerCase();
          return (
            aria.includes("@") &&
            (lower.includes("tài khoản") ||
              lower.includes("account") ||
              aria.includes("("))
          );
        }) ||
        all.find((el) => {
          const aria = (el.getAttribute("aria-label") || "").toLowerCase();
          return (
            aria.includes("tài khoản google") ||
            aria.includes("google account") ||
            aria.includes("tài khoản ai")
          );
        }) ||
        document.querySelector("a.mavatar-footer-left, .mavatar-footer-left");

      return {
        ariaLabel: avatarEl?.getAttribute("aria-label") || "",
        innerText: (avatarEl as HTMLElement)?.innerText || "",
      };
    });

    const parsed = this.parseAccountFromAria(avatarInfo.ariaLabel, currentUrl);
    if (!parsed || !parsed.email) {
      return null;
    }

    const existing = this.state.accounts.find((a) => a.email === parsed.email);
    const info: GoogleAccountInfo = {
      index: parsed.index ?? 0,
      email: parsed.email,
      name: parsed.name || existing?.name,
      plan: avatarInfo.innerText.includes("Pro") ? "Pro" : existing?.plan,
      hasLimitReached: existing?.hasLimitReached ?? false,
      resetTime: existing?.resetTime ?? null,
      lastCheckedMs: Date.now(),
    };

    this.upsertAccount(info);
    this.state.activeAccountIndex = info.index;
    this.saveState();
    return info;
  }

  /**
   * Scans and discovers all Google accounts currently logged into the browser session.
   * Probes /u/0/app, /u/1/app, /u/2/app... up to 10 indices.
   */
  public async discoverAccounts(
    page: Page,
    handleCaptcha?: (page: Page) => Promise<void>,
    onProgress?: (account: GoogleAccountInfo) => void
  ): Promise<GoogleAccountInfo[]> {
    if (!page || page.isClosed()) return this.state.accounts;

    const seenEmails = new Set<string>();
    const discovered: GoogleAccountInfo[] = [];

    for (let i = 0; i < 10; i++) {
      const targetUrl = `https://gemini.google.com/u/${i}/app`;
      try {
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25_000 });
        await page.waitForTimeout(2000);

        if (handleCaptcha) {
          await handleCaptcha(page);
          await page.waitForTimeout(1500);
        }

        const finalUrl = page.url();
        if (
          finalUrl.includes("/signin") ||
          finalUrl.includes("identifier") ||
          finalUrl.includes("challenge")
        ) {
          if (i > 0) break;
          continue;
        }

        const currentAcc = await this.getCurrentAccount(page);

        if (currentAcc && currentAcc.email) {
          const emailLower = currentAcc.email.toLowerCase();
          if (seenEmails.has(emailLower)) {
            // Google redirected to an already seen account (end of multi-login session)
            if (i > 0) break;
          } else {
            seenEmails.add(emailLower);
            const limitStatus = await this.checkUsageLimit(page);
            const accountItem: GoogleAccountInfo = {
              ...currentAcc,
              index: i,
              hasLimitReached: limitStatus.hasLimitReached,
              resetTime: limitStatus.resetTime || currentAcc.resetTime || null,
            };
            discovered.push(accountItem);
            if (onProgress) {
              onProgress(accountItem);
            }
          }
        } else {
          if (i > 0) break;
        }
      } catch {
        if (i > 0) break;
      }
    }

    if (discovered.length > 0) {
      this.state.accounts = discovered;
      this.saveState();
    }

    return this.state.accounts;
  }

  /**
   * Switches to a specific Google Account index (0, 1, 2...).
   */
  public async switchToAccount(
    page: Page,
    targetIndex: number,
    handleCaptcha?: (page: Page) => Promise<void>
  ): Promise<{ success: boolean; account?: GoogleAccountInfo; reason?: string }> {
    if (!page || page.isClosed()) {
      return { success: false, reason: "Page is closed" };
    }

    const targetUrl = `https://gemini.google.com/u/${targetIndex}/app`;
    console.log(`[AccountManager] Navigating to target account [${targetIndex}]: ${targetUrl}...`);

    try {
      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await page.waitForTimeout(2000);

      if (handleCaptcha) {
        await handleCaptcha(page);
        await page.waitForTimeout(1000);
      }

      // Check current URL after redirection
      const finalUrl = page.url();

      // Check if redirected to sign-in
      if (
        finalUrl.includes("accounts.google.com/v3/signin") ||
        finalUrl.includes("/signin/identifier") ||
        finalUrl.includes("challenge")
      ) {
        return {
          success: false,
          reason: `Account index [${targetIndex}] is not logged in on Google.`,
        };
      }

      // Check if redirected back to an index other than targetIndex (e.g. redirected to /u/0/app when target was 1)
      const uMatch = finalUrl.match(/\/u\/(\d+)/i);
      const actualIndex = uMatch ? parseInt(uMatch[1], 10) : 0;

      if (actualIndex !== targetIndex && targetIndex > 0) {
        return {
          success: false,
          reason: `Google redirected from /u/${targetIndex}/ back to /u/${actualIndex}/. Account [${targetIndex}] is not configured in this browser profile.`,
        };
      }

      // Read account details on page
      const current = await this.getCurrentAccount(page);
      if (!current) {
        return {
          success: false,
          reason: `Could not verify account identity on /u/${targetIndex}/app.`,
        };
      }

      this.state.activeAccountIndex = targetIndex;
      this.saveState();

      return {
        success: true,
        account: current,
      };
    } catch (err: any) {
      return {
        success: false,
        reason: err?.message || String(err),
      };
    }
  }

  /**
   * Automatically rotates to the next available Google Account in the multi-login session.
   * Searches for accounts with quota remaining, or probes the next index.
   */
  public async switchToNextAccount(
    page: Page,
    handleCaptcha?: (page: Page) => Promise<void>
  ): Promise<{ success: boolean; account?: GoogleAccountInfo; reason?: string }> {
    const current = await this.getCurrentAccount(page);
    const currentIndex = current?.index ?? this.state.activeAccountIndex;

    console.warn(
      `[AccountManager] Rotating away from account [${currentIndex}] (${current?.email || "active"}). Searching for alternative accounts...`
    );

    // Mark current account as having limit reached
    if (current) {
      this.markAccountLimitReached(current.email);
    }

    // 1. First, check if we already have other registered accounts in state that do NOT have limit reached
    const candidateAccounts = this.state.accounts.filter(
      (acc) => acc.index !== currentIndex && !acc.hasLimitReached
    );

    for (const cand of candidateAccounts) {
      console.log(`[AccountManager] Attempting switch to registered account [${cand.index}] (${cand.email})...`);
      const res = await this.switchToAccount(page, cand.index, handleCaptcha);
      if (res.success && res.account) {
        // Verify if this switched account also has limit reached
        const limitCheck = await this.checkUsageLimit(page);
        if (!limitCheck.hasLimitReached) {
          console.log(`[AccountManager] ✓ Successfully switched to healthy account: ${res.account.email}`);
          return { success: true, account: res.account };
        } else {
          console.warn(`[AccountManager] Account [${cand.index}] (${res.account.email}) also has limit reached.`);
          this.markAccountLimitReached(res.account.email, limitCheck.resetTime);
        }
      }
    }

    // 2. Probe next indices (e.g. current + 1, current + 2, up to index 5)
    const maxProbes = 4;
    for (let step = 1; step <= maxProbes; step++) {
      const probeIndex = (currentIndex + step) % 10;
      if (probeIndex === currentIndex) continue;

      // Skip if already confirmed exhausted
      const existing = this.state.accounts.find((a) => a.index === probeIndex);
      if (existing && existing.hasLimitReached) {
        continue;
      }

      console.log(`[AccountManager] Probing account index [${probeIndex}] at https://gemini.google.com/u/${probeIndex}/app...`);
      const res = await this.switchToAccount(page, probeIndex, handleCaptcha);
      if (res.success && res.account) {
        // Verify usage limit
        const limitCheck = await this.checkUsageLimit(page);
        if (!limitCheck.hasLimitReached) {
          console.log(`[AccountManager] ✓ Successfully discovered and switched to Google account [${probeIndex}]: ${res.account.email}`);
          return { success: true, account: res.account };
        } else {
          console.warn(`[AccountManager] Discovered account [${probeIndex}] (${res.account.email}) has reached its limit.`);
          this.markAccountLimitReached(res.account.email, limitCheck.resetTime);
        }
      }
    }

    return {
      success: false,
      reason:
        "Tất cả tài khoản Google hiện tại đã hết hạn mức sử dụng (hoặc chỉ có 1 tài khoản được đăng nhập trên Brave).",
    };
  }

  public upsertAccount(info: GoogleAccountInfo): void {
    const existingIndex = this.state.accounts.findIndex(
      (a) => a.email.toLowerCase() === info.email.toLowerCase() || a.index === info.index
    );
    if (existingIndex >= 0) {
      this.state.accounts[existingIndex] = {
        ...this.state.accounts[existingIndex],
        ...info,
      };
    } else {
      this.state.accounts.push(info);
    }
    this.saveState();
  }

  public markAccountLimitReached(emailOrIndex: string | number, resetTime?: string | null): void {
    for (let i = 0; i < this.state.accounts.length; i++) {
      const a = this.state.accounts[i];
      if (
        (typeof emailOrIndex === "number" && a.index === emailOrIndex) ||
        (typeof emailOrIndex === "string" && a.email.toLowerCase() === emailOrIndex.toLowerCase())
      ) {
        this.state.accounts[i] = {
          ...a,
          hasLimitReached: true,
          resetTime: resetTime || a.resetTime || null,
          lastCheckedMs: Date.now(),
        };
      }
    }
    this.saveState();
  }

  public clearAccountLimit(emailOrIndex: string | number): void {
    for (let i = 0; i < this.state.accounts.length; i++) {
      const a = this.state.accounts[i];
      if (
        (typeof emailOrIndex === "number" && a.index === emailOrIndex) ||
        (typeof emailOrIndex === "string" && a.email.toLowerCase() === emailOrIndex.toLowerCase())
      ) {
        this.state.accounts[i] = {
          ...a,
          hasLimitReached: false,
          resetTime: null,
          lastCheckedMs: Date.now(),
        };
      }
    }
    this.saveState();
  }
}
