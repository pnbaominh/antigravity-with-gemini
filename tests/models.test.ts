import { describe, it, expect } from "vitest";
import {
  REGISTERED_MODEL_CAPABILITIES,
  normalizeModelKey,
  resolveModelForTask,
} from "../src/models.js";

describe("Models Module (src/models.ts)", () => {
  it("should have gemini-4-argon with 8,192 thinking budget", () => {
    const argon = REGISTERED_MODEL_CAPABILITIES["gemini-4-argon"];
    expect(argon).toBeDefined();
    expect(argon.generation).toBe(4.0);
    expect(argon.thinkingBudget).toBe(8192);
    expect(argon.fallbackModelId).toBe("gemini-3.8-flash");
    expect(argon.webUiSelectorLabels).toContain("4 Argon");
  });

  it("should have gemini-3.8-flash registered with fallback to 3.1-pro", () => {
    const flash = REGISTERED_MODEL_CAPABILITIES["gemini-3.8-flash"];
    expect(flash).toBeDefined();
    expect(flash.generation).toBe(3.8);
    expect(flash.fallbackModelId).toBe("gemini-3.1-pro");
  });

  describe("normalizeModelKey", () => {
    it("should normalize Argon inputs to gemini-4-argon", () => {
      expect(normalizeModelKey("4 Argon")).toBe("gemini-4-argon");
      expect(normalizeModelKey("gemini-4.0-argon")).toBe("gemini-4-argon");
      expect(normalizeModelKey("argon")).toBe("gemini-4-argon");
    });

    it("should normalize Flash inputs to gemini-3.8-flash", () => {
      expect(normalizeModelKey("3.8 Flash")).toBe("gemini-3.8-flash");
      expect(normalizeModelKey("flash")).toBe("gemini-3.8-flash");
    });

    it("should normalize Pro inputs to gemini-3.1-pro", () => {
      expect(normalizeModelKey("3.1 Pro")).toBe("gemini-3.1-pro");
      expect(normalizeModelKey("pro")).toBe("gemini-3.1-pro");
    });

    it("should normalize Lite inputs to gemini-3.5-flash-lite", () => {
      expect(normalizeModelKey("Flash-Lite")).toBe("gemini-3.5-flash-lite");
      expect(normalizeModelKey("3.5")).toBe("gemini-3.5-flash-lite");
    });

    it("should default to gemini-4-argon when input is undefined", () => {
      expect(normalizeModelKey()).toBe("gemini-4-argon");
    });
  });

  describe("resolveModelForTask", () => {
    it("should resolve planning task to 4 Argon with 8,192 thinking budget", () => {
      const resolution = resolveModelForTask("plan");
      expect(resolution.primaryModel.id).toBe("gemini-4-argon");
      expect(resolution.enforcedThinkingBudget).toBe(8192);
      expect(resolution.fallbackChain.length).toBeGreaterThan(0);
      expect(resolution.fallbackChain[0].id).toBe("gemini-3.8-flash");
    });

    it("should resolve review task with fallback chain", () => {
      const resolution = resolveModelForTask("review", "3.8 Flash");
      expect(resolution.primaryModel.id).toBe("gemini-3.8-flash");
      expect(resolution.fallbackChain[0].id).toBe("gemini-3.1-pro");
    });
  });
});
