import { describe, it, expect } from "vitest";
import { PairingManager } from "../src/auth/pairing.js";

describe("PairingManager", () => {
  const ws = "test-workspace-root";

  it("should generate a 6-digit random pairing code", () => {
    const manager = new PairingManager();
    const code = manager.generateCode(ws);
    expect(code).toMatch(/^\d{6}$/);
    expect(manager.getActiveCode(ws)).toBe(code);
  });

  it("should verify correct pairing code and invalidate on use", () => {
    const manager = new PairingManager();
    const code = manager.generateCode(ws);

    const result = manager.verifyCode(ws, code);
    expect(result.success).toBe(true);

    // Should not be usable twice
    const secondResult = manager.verifyCode(ws, code);
    expect(secondResult.success).toBe(false);
  });

  it("should reject incorrect code and count attempts", () => {
    const manager = new PairingManager();
    manager.generateCode(ws);

    const wrong = manager.verifyCode(ws, "000000");
    expect(wrong.success).toBe(false);
    expect(wrong.error).toContain("attempt(s) remaining");
  });

  it("should expire after TTL", () => {
    const manager = new PairingManager();
    manager.generateCode(ws, -1000); // Already expired

    expect(manager.getActiveCode(ws)).toBeNull();
    const result = manager.verifyCode(ws, "123456");
    expect(result.success).toBe(false);
  });
});
