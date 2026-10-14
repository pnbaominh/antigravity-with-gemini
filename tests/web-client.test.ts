import { describe, it, expect, vi } from "vitest";
import { GeminiWebClient } from "../src/browser/gemini-web-client.js";
import { GeminiPlanner } from "../src/gemini/planner.js";
import type { GeminiGenerationClient } from "../src/gemini/client-interface.js";
import path from "path";
import os from "os";

describe("GeminiWebClient", () => {
  it("should initialize with default persistent user data directory", () => {
    const client = new GeminiWebClient();
    const expectedDir = path.join(os.homedir(), ".g2a", "browser_profile");
    expect(client.getUserDataDir()).toBe(expectedDir);
  });

  it("should detect installed browser and report isConfigured true", () => {
    const client = new GeminiWebClient();
    const isConfigured = client.isConfigured();
    expect(isConfigured).toBe(true);

    const execPath = client.getExecutablePath();
    expect(execPath).toBeTruthy();
  });

  it("should seamlessly integrate with GeminiPlanner as a GeminiGenerationClient", async () => {
    const samplePlan = `# Plan: Web Engine Generated Architecture
## 1. Executive Summary & Problem Framing
Build resilient browser automation bridge.
- **PERT Estimate:** Expected: 12.0h, Variance: 1.0h

## 2. Strict Scope & Boundaries
- In-Scope: Playwright integration.
- Non-Goals (Out of Scope):
  - No Electron custom apps.
  - No mobile emulation.
  - No captcha bypass service.

## 3. Pre-computation & Invariant Architecture
- Single DRI: Core Engine

## 4. RAID Log & Failure Modes
- R-01: Session timeout -> Mitigation: Persistent profile.

## 5. Phased Execution Roadmap
### Phase 1: Setup
- [NEW] test.ts
- Verification: npm test

## 6. Binary Acceptance Criteria
- [x] Pass all tests`;

    const mockWebClient: GeminiGenerationClient = {
      isConfigured: () => true,
      generate: vi.fn().mockResolvedValue({
        text: samplePlan,
        model: "gemini-web",
      }),
    };

    const planner = new GeminiPlanner(mockWebClient);
    const planResult = await planner.createPlan({
      task: "Test Web Client Plan Generation",
      workspaceSummary: "Project: test-workspace",
    });

    expect(planResult.title).toBe("Web Engine Generated Architecture");
    expect(planResult.phases).toHaveLength(1);
    expect(planResult.phases[0].phase).toContain("Setup");
    expect(mockWebClient.generate).toHaveBeenCalled();
  });

  it("should detect Vietnamese and English backend refusal messages accurately", () => {
    const client = new GeminiWebClient();

    // Vietnamese refusals
    expect(
      client.isBackendError("Tôi chỉ là một mô hình ngôn ngữ, nên không thể trợ giúp về điều đó.")
    ).toBe(true);
    expect(client.isBackendError("Tôi không thể hỗ trợ điều đó")).toBe(true);
    expect(client.isBackendError("Tôi là một mô hình ngôn ngữ lớn")).toBe(true);
    expect(client.isBackendError("Đã xảy ra sự cố trong quá trình xử lý")).toBe(true);

    // English refusals
    expect(client.isBackendError("I'm just a language model, so I can't help with that.")).toBe(true);
    expect(client.isBackendError("As a language model, I cannot assist with this request.")).toBe(true);
    expect(client.isBackendError("Sorry, something went wrong. Please try again.")).toBe(true);

    // Valid plan outputs should NOT be flagged as errors
    expect(
      client.isBackendError(
        "# Plan: Microservices Migration\nDRI: lead_architect\n## 1. AS-IS State & System Architecture Blueprint"
      )
    ).toBe(false);
  });

  it("should configure default preferred model to 4 Argon", () => {
    const client = new GeminiWebClient();
    // @ts-expect-error - inspect private config
    expect(client.config.preferredModel).toBe("4 Argon");
  });

  describe("AsyncMutex & Resilience Utilities", () => {
    it("should ensure sequential exclusive execution with AsyncMutex", async () => {
      const { AsyncMutex } = await import("../src/browser/gemini-web-client.js");
      const mutex = new AsyncMutex();
      const order: number[] = [];

      const p1 = mutex.runExclusive(async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push(1);
      });
      const p2 = mutex.runExclusive(async () => {
        order.push(2);
      });

      await Promise.all([p1, p2]);
      expect(order).toEqual([1, 2]);
    });

    it("should trip circuit breaker after reaching failure threshold", async () => {
      const { WebEngineCircuitBreaker } = await import("../src/browser/gemini-web-client.js");
      const cb = new WebEngineCircuitBreaker(2, 500);

      expect(cb.canExecute()).toBe(true);
      cb.recordFailure();
      expect(cb.canExecute()).toBe(true);
      cb.recordFailure(); // Reached threshold (2)
      expect(cb.canExecute()).toBe(false);
      expect(cb.getSnapshot().state).toBe("OPEN");

      // After resetTimeoutMs, it should transition to HALF_OPEN
      await new Promise((r) => setTimeout(r, 550));
      expect(cb.canExecute()).toBe(true);
      expect(cb.getSnapshot().state).toBe("HALF_OPEN");

      // Successful attempt resets to CLOSED
      cb.recordSuccess();
      expect(cb.getSnapshot().state).toBe("CLOSED");
    });

    it("should compute backoff with jitter within expected bounds", async () => {
      const { computeBackoffWithJitter } = await import("../src/browser/gemini-web-client.js");
      const b0 = computeBackoffWithJitter(0, 1000);
      expect(b0).toBeGreaterThanOrEqual(1000);
      expect(b0).toBeLessThan(1500);

      const b1 = computeBackoffWithJitter(1, 1000);
      expect(b1).toBeGreaterThanOrEqual(2000);
    });
  });
});

