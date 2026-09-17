import { describe, it, expect } from "vitest";
import path from "node:path";
import { resolveSafePath, isSensitiveFile, SecurityError } from "../src/workspace/sanitize.js";

describe("Workspace Path Sanitizer & Security", () => {
  const root = path.resolve(process.cwd());

  it("should allow safe relative paths inside workspace", () => {
    const { safePath, relativePath } = resolveSafePath(root, "package.json");
    expect(safePath).toContain("package.json");
    expect(relativePath).toBe("package.json");
  });

  it("should block path traversal outside workspace root", () => {
    expect(() => {
      resolveSafePath(root, "../../../Windows/System32");
    }).toThrow(SecurityError);
  });

  it("should detect sensitive files", () => {
    expect(isSensitiveFile(".env")).toBe(true);
    expect(isSensitiveFile(".env.local")).toBe(true);
    expect(isSensitiveFile(".env.production")).toBe(true);
    expect(isSensitiveFile("id_rsa")).toBe(true);
    expect(isSensitiveFile("id_ed25519")).toBe(true);
    expect(isSensitiveFile("server.key")).toBe(true);
    expect(isSensitiveFile(".git/credentials")).toBe(true);
  });

  it("should allow safe template files like .env.example", () => {
    expect(isSensitiveFile(".env.example")).toBe(false);
    expect(isSensitiveFile(".env.sample")).toBe(false);
    expect(isSensitiveFile(".env.template")).toBe(false);
  });

  it("should throw SecurityError when attempting to resolve sensitive file", () => {
    expect(() => {
      resolveSafePath(root, ".env");
    }).toThrow(SecurityError);
  });
});
