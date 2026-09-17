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
});
