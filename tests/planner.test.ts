import { describe, it, expect, vi } from "vitest";
import { GeminiPlanner } from "../src/gemini/planner.js";
import { GeminiThinkingClient } from "../src/gemini/client.js";

describe("GeminiPlanner", () => {
  const sampleArchitectPlan = `# Plan: Distributed Redis Cache with TTL Invalidation
DRI: @lead_architect

## 1. Executive Summary & AS-IS Grounding
Implement a two-tier cache with local in-memory L1 and distributed Redis L2.
- \`package.json\`: Workspace descriptor with vitest
- \`src/cache/types.ts\`: Initial cache interfaces

## 2. Non-Goals & Scope Boundaries (Mandatory >= 3)
1. No migration of relational database tables
2. No rewrite of user authentication layer
3. No GraphQL subscription caching

## 3. Unknowns & Halt Checks
- Status: CLEAR
- Unknowns: None

## 4. Pre-Mortem & RAID Log
| ID | Category | Description | Impact | Likelihood | Mitigation | Owner DRI |
| R-1 | Risk | Cache stampede on expired keys | High | Medium | Implement mutex lock | @lead_architect |

## 5. Work Breakdown Structure (WBS) & Phased Implementation

### Phase 1: Foundation & Cache Interfaces
- [ ] Task 1.1: Create ICacheProvider interface in src/cache/types.ts
- [ ] Task 1.2: Implement InMemoryCache provider for L1 cache
**Verification:** npm test tests/cache-types.test.ts
PERT: O=2, M=4, P=6

### Phase 2: Distributed Redis Provider
- [ ] Task 2.1: Implement RedisCache provider with TTL support in src/cache/redis.ts
- [ ] Task 2.2: Add auto-reconnect and circuit breaker logic
**Verification:** npm test tests/redis.test.ts
PERT: O=3, M=6, P=9

### Phase 3: Integration & Invalidation Bus
- [ ] Task 3.1: Connect Redis PubSub for cross-node L1 invalidation
- [ ] Task 3.2: Verify zero cache stampede on expired keys
**Verification:** npm test tests/invalidation.test.ts
PERT: O=2, M=4, P=6

## 6. Acceptance Criteria & Quality Gates
- [ ] 100% test coverage on cache module
- [ ] Zero TypeScript compilation errors
- [ ] Fallback graceful degradation when Redis is offline`;

  it("should parse phases, tasks, and verification from 5-section Principal Architect plan", () => {
    const dummyClient = {} as GeminiThinkingClient;
    const planner = new GeminiPlanner(dummyClient);

    // @ts-expect-error - testing private parsePhases method
    const phases = planner.parsePhases(sampleArchitectPlan);

    expect(phases).toHaveLength(3);
    expect(phases[0].phase).toContain("1: Foundation & Cache Interfaces");
    expect(phases[0].tasks).toEqual([
      "Task 1.1: Create ICacheProvider interface in src/cache/types.ts",
      "Task 1.2: Implement InMemoryCache provider for L1 cache",
    ]);
    expect(phases[0].verification).toBe("npm test tests/cache-types.test.ts");

    expect(phases[1].phase).toContain("2: Distributed Redis Provider");
    expect(phases[1].tasks).toHaveLength(2);
    expect(phases[1].verification).toBe("npm test tests/redis.test.ts");

    expect(phases[2].phase).toContain("3: Integration & Invalidation Bus");
    expect(phases[2].tasks).toHaveLength(2);
    expect(phases[2].verification).toBe("npm test tests/invalidation.test.ts");
  });

  it("should support legacy ## Phase format for backward compatibility", () => {
    const legacyPlan = `# Plan: Legacy Refactor
## Phase 1: Setup
- [ ] Task 1: Create index
**Verification:** npm test

## Phase 2: Deploy
- [ ] Task 2: Run deploy
**Verification:** npm run deploy
`;
    const dummyClient = {} as GeminiThinkingClient;
    const planner = new GeminiPlanner(dummyClient);

    // @ts-expect-error - testing private parsePhases method
    const phases = planner.parsePhases(legacyPlan);

    expect(phases).toHaveLength(2);
    expect(phases[0].phase).toContain("1: Setup");
    expect(phases[0].tasks).toEqual(["Task 1: Create index"]);
    expect(phases[0].verification).toBe("npm test");
  });

  it("should create plan and extract title, summary, and compact plan", async () => {
    const mockClient = {
      generate: vi.fn().mockResolvedValue({
        text: sampleArchitectPlan,
        model: "gemini-3.6-flash",
      }),
    } as unknown as GeminiThinkingClient;

    const planner = new GeminiPlanner(mockClient);
    const result = await planner.createPlan({
      task: "Build distributed Redis cache",
      workspaceSummary: "Project: test-repo",
      skipReview: true,
    });

    expect(result.title).toBe("Distributed Redis Cache with TTL Invalidation");
    expect(result.summary).toContain("Implement a two-tier cache with local in-memory L1");
    expect(result.phases).toHaveLength(3);
    expect(result.compactMarkdown).toBeDefined();
    expect(result.compactMarkdown.length).toBeLessThan(result.rawMarkdown.length);
    expect(result.governance).toBeDefined();
    expect(result.governance?.valid).toBe(true);
    expect(result.haltOnUnknown).toBe(false);
    expect(mockClient.generate).toHaveBeenCalledWith(
      expect.stringContaining("Build distributed Redis cache"),
      expect.objectContaining({
        thinkingBudget: 4096,
        systemInstruction: expect.stringContaining("RULES.MD"),
      })
    );
  });

  it("should perform closed-loop audit and trigger self-correction when needed", async () => {
    const auditReviewText = `# Audit Score: 78
# Audit Verdict: NEEDS_REVISION

## Audit Critique
Draft plan is missing concrete race-condition locks for cache stampede.

## Key Issues Found
- Cache stampede mutex not explicitly implemented
- Windows path separators in file paths

## Required Refinements
- Add DistributedLock class in src/cache/lock.ts
- Add verification command for concurrency race test`;

    const refinedPlanText = `# Plan: Hardened Distributed Redis Cache with Mutex Lock

## 1. Executive Summary & Architecture Strategy
Implement hardened Redis caching with DistributedLock to prevent stampede.

## 2. File-by-File Technical Specification
- \`[NEW] src/cache/lock.ts\`: Redlock algorithm implementation.

## 3. Deep Technical Traps, Edge Cases & Guardrails
- Concurrency stampede solved via distributed mutex locks.

## 4. Phased Implementation Plan

### Phase 1: Core Lock & Redis
- [ ] Task 1.1: Implement Redlock mutex in src/cache/lock.ts
**Verification:** npm test tests/lock.test.ts

## 5. Acceptance Criteria & Quality Gates
- Concurrency test passes 100%.`;

    let callCount = 0;
    const mockClient = {
      generate: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { text: sampleArchitectPlan, model: "gemini-3.6-flash" };
        } else if (callCount === 2) {
          return { text: auditReviewText, model: "gemini-3.6-flash" };
        } else {
          return { text: refinedPlanText, model: "gemini-3.6-flash" };
        }
      }),
    } as unknown as GeminiThinkingClient;

    const planner = new GeminiPlanner(mockClient);
    const result = await planner.createPlan({
      task: "Build distributed Redis cache with mutex",
      workspaceSummary: "Project: test-repo",
    });

    expect(callCount).toBe(3); // 1. Draft -> 2. Audit -> 3. Self-Correction Refinement
    expect(result.audit).toBeDefined();
    expect(result.audit?.score).toBe(78);
    expect(result.audit?.verdict).toBe("REFINED");
    expect(result.audit?.identifiedIssues).toContain("Cache stampede mutex not explicitly implemented");
    expect(result.title).toBe("Hardened Distributed Redis Cache with Mutex Lock");
    expect(result.draftMarkdown).toBe(sampleArchitectPlan);
    expect(result.compactMarkdown).toContain("Hardened Distributed Redis Cache with Mutex Lock");
    expect(result.compactMarkdown).toContain("**Gemini Architect Score:** 78/100");
  });

  it("should generate a zero-token pointer ticket with metadata and file path", () => {
    const dummyClient = {} as GeminiThinkingClient;
    const planner = new GeminiPlanner(dummyClient);

    const ticketJson = planner.generatePointerTicket({
      planId: "plan-test-123",
      title: "Test Plan Title",
      artifactPath: "c:/repo/.g2a/plans/plan-test-123.md",
      totalPhases: 3,
      auditScore: 92,
      auditVerdict: "APPROVED",
    });

    const parsed = JSON.parse(ticketJson);
    expect(parsed.status).toBe("READY");
    expect(parsed.planId).toBe("plan-test-123");
    expect(parsed.score).toBe(92);
    expect(parsed.totalPhases).toBe(3);
    expect(parsed.artifactFile).toBe("c:/repo/.g2a/plans/plan-test-123.md");
    expect(ticketJson.length).toBeLessThan(400);
  });

  it("should extract individual phase on-demand (JIT)", () => {
    const dummyClient = {} as GeminiThinkingClient;
    const planner = new GeminiPlanner(dummyClient);

    const phase1 = planner.extractPhase(sampleArchitectPlan, 1);
    expect(phase1).not.toBeNull();
    expect(phase1?.phaseIndex).toBe(1);
    expect(phase1?.totalPhases).toBe(3);
    expect(phase1?.tasks).toHaveLength(2);
    expect(phase1?.verification).toBe("npm test tests/cache-types.test.ts");
    expect(phase1?.markdown).toContain("Task 1.1: Create ICacheProvider");

    const phase2 = planner.extractPhase(sampleArchitectPlan, 2);
    expect(phase2?.phaseIndex).toBe(2);
    expect(phase2?.tasks).toHaveLength(2);

    const phaseOut = planner.extractPhase(sampleArchitectPlan, 99);
    expect(phaseOut).toBeNull();
  });

  it("should reject conversational filler draft and force self-correction into complete plan", async () => {
    const fillerDraft = "I will start by listing the contents of the root workspace directory...";
    let callCount = 0;
    const mockClient = {
      generate: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { text: fillerDraft, model: "gemini-3.5-flash" };
        } else {
          // Refine call
          return { text: sampleArchitectPlan, model: "gemini-3.5-flash" };
        }
      }),
    } as unknown as GeminiThinkingClient;

    const planner = new GeminiPlanner(mockClient);
    const result = await planner.createPlan({
      task: "Build distributed Redis cache",
      workspaceSummary: "Project: test-repo",
    });

    expect(result.audit?.verdict).toBe("REFINED");
    expect(result.audit?.score).toBeLessThan(90);
    expect(result.title).toBe("Distributed Redis Cache with TTL Invalidation");
    expect(result.phases).toHaveLength(3);
  });

  it("should load physical RULES.MD from disk and inject into prompt", async () => {
    const { loadRulesContent } = await import("../src/gemini/planner.js");
    const rulesText = loadRulesContent();
    expect(rulesText.length).toBeGreaterThan(500);
    expect(rulesText).toContain("BỘ QUY CHUẨN QUẢN TRỊ KỸ THUẬT: RULES.MD");
    expect(rulesText).toContain("FUNDAMENTAL AXIOMS");

    let capturedPrompt = "";
    const mockClient = {
      generate: vi.fn().mockImplementation(async (prompt: string) => {
        capturedPrompt = prompt;
        return { text: sampleArchitectPlan, model: "3.8-flash" };
      }),
    } as unknown as GeminiThinkingClient;

    const planner = new GeminiPlanner(mockClient);
    await planner.createPlan({
      task: "Build notification service",
      workspaceSummary: "Project: test",
      skipReview: true,
    });

    expect(capturedPrompt).toContain("BỘ QUY CHUẨN QUẢN TRỊ KỸ THUẬT: RULES.MD");
    expect(capturedPrompt).toContain("FUNDAMENTAL AXIOMS");
  });

  it("should perform deep pre-planning technical investigation and inject dossier into prompt", async () => {
    const dummyClient = {} as GeminiThinkingClient;
    const planner = new GeminiPlanner(dummyClient);

    const dossier = planner.investigatePrerequisites(process.cwd(), "Xây dựng hệ thống REST API và quản lý giao diện UI");
    expect(dossier).toContain("PRE-PLANNING RECONNAISSANCE DOSSIER");
    expect(dossier).toContain("Dự án / Ứng dụng: antigravity-with-gemini");
    expect(dossier).toContain("Kiến trúc API endpoints");
    expect(dossier).toContain("Quản lý UI state");

    let capturedPrompt = "";
    const mockClient = {
      generate: vi.fn().mockImplementation(async (prompt: string) => {
        capturedPrompt = prompt;
        return { text: sampleArchitectPlan, model: "3.8-flash" };
      }),
    } as unknown as GeminiThinkingClient;

    const testPlanner = new GeminiPlanner(mockClient);
    await testPlanner.createPlan({
      task: "Xây dựng REST API",
      workspaceSummary: "Project: antigravity-with-gemini",
      workspaceRoot: process.cwd(),
      skipReview: true,
    });

    expect(capturedPrompt).toContain("PRE-PLANNING RECONNAISSANCE DOSSIER");
    expect(capturedPrompt).toContain("Dự án / Ứng dụng: antigravity-with-gemini");
  });

  it("should maintain single-chat conversation continuity (continueConversation: true) during plan refinement", async () => {
    const capturedOptions: any[] = [];
    const mockClient = {
      generate: vi.fn().mockImplementation(async (_prompt: string, options?: any) => {
        capturedOptions.push(options);
        if (capturedOptions.length === 1) {
          // Incomplete draft triggering refinement
          return { text: "Short incomplete draft", model: "3.8-flash" };
        } else {
          return { text: sampleArchitectPlan, model: "3.8-flash" };
        }
      }),
    } as unknown as GeminiThinkingClient;

    const planner = new GeminiPlanner(mockClient);
    await planner.createPlan({
      task: "Build caching system",
      workspaceSummary: "Project: test",
    });

    // 1st call (Draft): continueConversation MUST be false (start chat thread)
    expect(capturedOptions[0].continueConversation).toBe(false);

    // Refinement call: continueConversation MUST be true (keep exact same chat thread!)
    expect(capturedOptions[capturedOptions.length - 1].continueConversation).toBe(true);
  });
});


