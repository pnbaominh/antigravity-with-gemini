import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GoogleAccountManager } from "../src/browser/account-manager.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("GoogleAccountManager", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "g2a-account-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("should parse account email, name, and index accurately from aria-label and URL", () => {
    const manager = new GoogleAccountManager(tempDir);

    // Vietnamese format
    const vn = manager.parseAccountFromAria(
      "Tài khoản Google: minh bao (baominh201208@gmail.com)",
      "https://gemini.google.com/app"
    );
    expect(vn).not.toBeNull();
    expect(vn?.email).toBe("baominh201208@gmail.com");
    expect(vn?.name).toBe("minh bao");
    expect(vn?.index).toBe(0);

    // Multi-account /u/1/app URL
    const u1 = manager.parseAccountFromAria(
      "Tài khoản Google: bao minh \n(baominh201208@gmail.com), Gói thành viên của Google",
      "https://gemini.google.com/u/1/app"
    );
    expect(u1?.email).toBe("baominh201208@gmail.com");
    expect(u1?.index).toBe(1);

    // English format with authuser query param
    const en = manager.parseAccountFromAria(
      "Google Account: John Doe (john.doe@gmail.com)",
      "https://gemini.google.com/app?authuser=2"
    );
    expect(en?.email).toBe("john.doe@gmail.com");
    expect(en?.name).toBe("John Doe");
    expect(en?.index).toBe(2);
  });

  it("should accurately detect Vietnamese usage limit messages matching real Gemini UI", () => {
    const manager = new GoogleAccountManager(tempDir);

    // Exact text from user screenshot
    const res1 = manager.isUsageLimitText(
      "Bạn đã đạt đến hạn mức sử dụng hiện tại. Bạn sẽ có thể tiếp tục thực hiện các nhiệm vụ lúc 1:22 ngày 18 thg 10 hoặc nâng cấp để có hạn mức cao hơn."
    );
    expect(res1.reached).toBe(true);
    expect(res1.resetTime).toContain("1:22 ngày 18 thg 10");

    // Input header text from user screenshot
    const res2 = manager.isUsageLimitText("Hạn mức của bạn sẽ được đặt lại vào thg 10 18");
    expect(res2.reached).toBe(true);

    // English usage limit text
    const res3 = manager.isUsageLimitText("You've reached your current usage limit. Your limit will reset at 2:00 PM.");
    expect(res3.reached).toBe(true);

    // Normal plan text should NOT be flagged
    const normal = manager.isUsageLimitText(
      "# Plan: Microservices Architecture\n## 1. AS-IS State\nVerification: npm test"
    );
    expect(normal.reached).toBe(false);
  });

  it("should manage account pool state, mark limit reached, and persist to accounts.json", () => {
    const manager = new GoogleAccountManager(tempDir);

    manager.upsertAccount({
      index: 0,
      email: "acc1@gmail.com",
      name: "Account 1",
      hasLimitReached: false,
    });
    manager.upsertAccount({
      index: 1,
      email: "acc2@gmail.com",
      name: "Account 2",
      hasLimitReached: false,
    });

    let state = manager.getState();
    expect(state.accounts).toHaveLength(2);

    // Mark acc1 as having reached limit
    manager.markAccountLimitReached("acc1@gmail.com", "1:22 ngày 18 thg 10");
    state = manager.getState();
    expect(state.accounts[0].hasLimitReached).toBe(true);
    expect(state.accounts[0].resetTime).toBe("1:22 ngày 18 thg 10");
    expect(state.accounts[1].hasLimitReached).toBe(false);

    // Clear limit
    manager.clearAccountLimit("acc1@gmail.com");
    state = manager.getState();
    expect(state.accounts[0].hasLimitReached).toBe(false);
    expect(state.accounts[0].resetTime).toBeNull();
  });

  it("should reload saved state from accounts.json across instances", () => {
    const manager1 = new GoogleAccountManager(tempDir);
    manager1.upsertAccount({
      index: 0,
      email: "primary@gmail.com",
      name: "Primary User",
      hasLimitReached: true,
      resetTime: "Tomorrow 9:00 AM",
    });

    // Create new manager on same directory
    const manager2 = new GoogleAccountManager(tempDir);
    const state = manager2.getState();
    expect(state.accounts[0].resetTime).toBe("Tomorrow 9:00 AM");
  });

  it("should switch to next available account when current account has limit reached", async () => {
    const manager = new GoogleAccountManager(tempDir);
    manager.upsertAccount({
      index: 0,
      email: "exhausted@gmail.com",
      name: "User 1",
      hasLimitReached: true,
      resetTime: "1:22 ngày 18 thg 10",
    });
    manager.upsertAccount({
      index: 1,
      email: "backup@gmail.com",
      name: "User 2",
      hasLimitReached: false,
    });

    let currentMockIndex = 0;
    const mockPage: any = {
      isClosed: () => false,
      url: () => `https://gemini.google.com/u/${currentMockIndex}/app`,
      goto: async (targetUrl: string) => {
        const m = targetUrl.match(/\/u\/(\d+)/);
        if (m) currentMockIndex = parseInt(m[1], 10);
      },
      waitForTimeout: async () => {},
      evaluate: async (fn: any, args: any) => {
        if (currentMockIndex === 0) {
          return {
            hasLimit: true,
            reason: "Bạn đã đạt đến hạn mức",
            resetTime: "1:22 ngày 18 thg 10",
            ariaLabel: "Tài khoản Google: User 1 (exhausted@gmail.com)",
            innerText: "User 1\nPro",
          };
        }
        return {
          hasLimit: false,
          reason: undefined,
          resetTime: "",
          ariaLabel: "Tài khoản Google: User 2 (backup@gmail.com)",
          innerText: "User 2\nPro",
        };
      },
    };

    const res = await manager.switchToNextAccount(mockPage);
    expect(res.success).toBe(true);
    expect(res.account?.email).toBe("backup@gmail.com");
    expect(res.account?.index).toBe(1);
    expect(manager.getState().activeAccountIndex).toBe(1);
  });

  it("should detect when all accounts in pool are exhausted", async () => {
    const manager = new GoogleAccountManager(tempDir);
    manager.upsertAccount({
      index: 0,
      email: "acc1@gmail.com",
      hasLimitReached: true,
    });
    manager.upsertAccount({
      index: 1,
      email: "acc2@gmail.com",
      hasLimitReached: true,
    });

    // Mock page redirects back to index 0 on probe
    const mockPage: any = {
      isClosed: () => false,
      url: () => "https://gemini.google.com/u/0/app",
      goto: async () => {},
      waitForTimeout: async () => {},
      evaluate: async () => ({
        hasLimit: true,
        reason: "đạt đến hạn mức",
        resetTime: "thg 10 18",
        ariaLabel: "Tài khoản Google: User 1 (acc1@gmail.com)",
        innerText: "User 1",
      }),
    };

    const res = await manager.switchToNextAccount(mockPage);
    expect(res.success).toBe(false);
    expect(res.reason).toContain("hết hạn mức");
  });

  it("should discover multi-login accounts across /u/0, /u/1, etc. and stop when redirected", async () => {
    const manager = new GoogleAccountManager(tempDir);
    let visitedUrl = "";
    const mockPage: any = {
      isClosed: () => false,
      url: () => visitedUrl,
      goto: async (url: string) => {
        visitedUrl = url;
      },
      waitForTimeout: async () => {},
      evaluate: async () => {
        if (visitedUrl.includes("/u/0/")) {
          return {
            hasLimit: false,
            ariaLabel: "Tài khoản Google: Minh Bao (baominh201208@gmail.com)",
            innerText: "Minh Bao\nPro",
          };
        }
        if (visitedUrl.includes("/u/1/")) {
          return {
            hasLimit: false,
            ariaLabel: "Tài khoản Google: Bon Minh (bonminhlao@gmail.com)",
            innerText: "Bon Minh\nPro",
          };
        }
        // At /u/2/, Google redirects back to /u/0/ (already seen email)
        visitedUrl = "https://gemini.google.com/u/0/app";
        return {
          hasLimit: false,
          ariaLabel: "Tài khoản Google: Minh Bao (baominh201208@gmail.com)",
          innerText: "Minh Bao\nPro",
        };
      },
    };

    const discovered = await manager.discoverAccounts(mockPage);
    expect(discovered).toHaveLength(2);
    expect(discovered[0].email).toBe("baominh201208@gmail.com");
    expect(discovered[0].index).toBe(0);
    expect(discovered[1].email).toBe("bonminhlao@gmail.com");
    expect(discovered[1].index).toBe(1);
    expect(manager.getState().accounts).toHaveLength(2);
  });
});

