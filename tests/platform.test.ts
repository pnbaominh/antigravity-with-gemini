import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  normalizeWorkspacePath,
  normalizeLineEndings,
  getPlatformCommand,
  cleanupBrowserSingletonLocks,
} from "../src/utils/platform.js";

describe("Platform Utils (src/utils/platform.ts)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "g2a-platform-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("normalizeWorkspacePath", () => {
    it("should resolve and convert backslashes to forward slashes", () => {
      const normalized = normalizeWorkspacePath("foo/bar\\baz");
      expect(normalized).not.toContain("\\");
      expect(normalized).toContain("/foo/bar/baz");
    });

    it("should capitalize drive letter on Windows paths", () => {
      if (process.platform === "win32") {
        const drivePath = "c:\\users\\test\\project";
        const normalized = normalizeWorkspacePath(drivePath);
        expect(normalized.startsWith("C:/")).toBe(true);
      }
    });

    it("should return empty string for falsy input", () => {
      expect(normalizeWorkspacePath("")).toBe("");
    });
  });

  describe("normalizeLineEndings", () => {
    it("should convert CRLF to LF", () => {
      const crlf = "line1\r\nline2\r\nline3\r\n";
      const lf = normalizeLineEndings(crlf);
      expect(lf).toBe("line1\nline2\nline3\n");
      expect(lf).not.toContain("\r");
    });

    it("should keep LF unchanged", () => {
      const lf = "line1\nline2\n";
      expect(normalizeLineEndings(lf)).toBe(lf);
    });
  });

  describe("getPlatformCommand", () => {
    it("should return .cmd on win32 for npm and npx", () => {
      if (process.platform === "win32") {
        expect(getPlatformCommand("npm")).toBe("npm.cmd");
        expect(getPlatformCommand("npx")).toBe("npx.cmd");
        expect(getPlatformCommand("git")).toBe("git");
      } else {
        expect(getPlatformCommand("npm")).toBe("npm");
        expect(getPlatformCommand("npx")).toBe("npx");
      }
    });
  });

  describe("cleanupBrowserSingletonLocks", () => {
    it("should report isClean: true when no lock files exist", async () => {
      const result = await cleanupBrowserSingletonLocks(tempDir);
      expect(result.isClean).toBe(true);
      expect(result.removedLockFiles).toHaveLength(0);
      expect(result.lockedByActiveProcessFiles).toHaveLength(0);
    });

    it("should delete existing lock files safely", async () => {
      fs.writeFileSync(path.join(tempDir, "SingletonLock"), "mock-lock");
      fs.writeFileSync(path.join(tempDir, "lockfile"), "");

      const result = await cleanupBrowserSingletonLocks(tempDir);
      expect(result.isClean).toBe(true);
      expect(result.removedLockFiles).toContain("SingletonLock");
      expect(result.removedLockFiles).toContain("lockfile");
      expect(fs.existsSync(path.join(tempDir, "SingletonLock"))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, "lockfile"))).toBe(false);
    });

    it("should handle non-existent directory gracefully", async () => {
      const nonExistent = path.join(tempDir, "does-not-exist");
      const result = await cleanupBrowserSingletonLocks(nonExistent);
      expect(result.isClean).toBe(true);
      expect(result.removedLockFiles).toHaveLength(0);
    });
  });
});
