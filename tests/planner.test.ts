import { describe, it, expect, vi } from "vitest";
import { GeminiPlanner } from "../src/gemini/planner.js";
import { GeminiThinkingClient } from "../src/gemini/client.js";

describe("GeminiPlanner", () => {
  const sampleArchitectPlan = `# Plan: Distributed Redis Cache with TTL Invalidation

## 1. Executive Summary & Architecture Strategy
- **Core Approach**: Implement a two-tier cache with local in-memory L1 (LRU) and distributed Redis L2.
- **Trade-Offs & Alternatives Evaluated**: Evaluated Option A (direct Redis only) vs Option B (two-tier L1+L2). Option B minimizes Redis roundtrip latency.
- **Blast Radius & Impact Analysis**: Touches cache layer and data store repositories. No breaking API changes to downstream services.
- **Data Flow & State Lifecycle**: Read requests check L1 -> check L2 -> load from DB -> write back L2 and L1.

## 2. File-by-File Technical Specification
- \`[NEW] src/cache/redis.ts\`: Redis client wrapper with connection pooling.
- \`[NEW] src/cache/tier.ts\`: Multi-tier orchestrator.
- \`[TEST] tests/cache.test.ts\`: Unit tests with mock Redis.

## 3. Deep Technical Traps, Edge Cases & Guardrails
- **Concurrency & Race Conditions**: Mutex locks on cache stampede.
- **Resilience & Failure Modes**: Redis connection fallback to L1 cache if down.
- **Platform & Runtime Quirks**: Cross-platform support for Redis URLs.

## 4. Phased Implementation Plan

### Phase 1: Foundation & Cache Interfaces
- [ ] Task 1.1: Create ICacheProvider interface in src/cache/types.ts
- [ ] Task 1.2: Implement InMemoryCache provider for L1 cache
**Verification:** npm test tests/cache-types.test.ts

### Phase 2: Distributed Redis Provider
- [ ] Task 2.1: Implement RedisCache provider with TTL support in src/cache/redis.ts
- [ ] Task 2.2: Add auto-reconnect and circuit breaker logic
**Verification:** npm test tests/redis.test.ts

### Phase 3: Integration & Invalidation Bus
- [ ] Task 3.1: Connect Redis PubSub for cross-node L1 invalidation
- [ ] Task 3.2: Verify zero cache stampede on expired keys
**Verification:** npm test tests/invalidation.test.ts

## 5. Acceptance Criteria & Quality Gates
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
    expect(result.tokenReductionPercent).toBeGreaterThan(25);
    expect(mockClient.generate).toHaveBeenCalledWith(
      expect.stringContaining("Build distributed Redis cache"),
      expect.objectContaining({
        thinkingBudget: 4096,
        systemInstruction: expect.stringContaining("Principal Software Architect"),
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
});
