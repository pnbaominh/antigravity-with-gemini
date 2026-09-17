import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { PlanHistoryStore } from "../src/gemini/history.js";

describe("PlanHistoryStore", () => {
  let tempWorkspace: string;
  let store: PlanHistoryStore;

  beforeEach(() => {
    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "g2a-history-test-"));
    store = new PlanHistoryStore(tempWorkspace);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempWorkspace, { recursive: true, force: true });
    } catch {}
  });

  it("should return empty list when no plans saved", () => {
    expect(store.getPlans()).toEqual([]);
    expect(store.getLatestPlan()).toBeNull();
  });

  it("should save and retrieve plans in order", () => {
    const p1 = store.savePlan({
      task: "Task 1",
      source: "cli",
      model: "gemini-3.8-flash",
      title: "Plan 1",
      summary: "Summary 1",
      phases: [],
      rawMarkdown: "# Plan 1",
    });

    const p2 = store.savePlan({
      task: "Task 2",
      source: "web",
      model: "gemini-3.8-flash",
      title: "Plan 2",
      summary: "Summary 2",
      phases: [],
      rawMarkdown: "# Plan 2",
    });

    expect(p1.id).toBeDefined();
    expect(p2.id).toBeDefined();

    const all = store.getPlans();
    expect(all).toHaveLength(2);
    expect(all[0].task).toBe("Task 1");
    expect(all[1].task).toBe("Task 2");

    const latest = store.getLatestPlan();
    expect(latest?.task).toBe("Task 2");
    expect(latest?.source).toBe("web");
  });

  it("should save audit metadata and export .g2a/plans/<id>.md artifact", () => {
    const plan = store.savePlan({
      task: "Optimize Queries",
      source: "mcp",
      model: "gemini-3.6-flash",
      title: "Query Optimization Plan",
      summary: "Database query tuning",
      phases: [
        {
          phase: "1: Indexing",
          tasks: ["Add composite index"],
          verification: "npm test",
        },
      ],
      rawMarkdown: "# Query Optimization Plan\nFull content here.",
      compactMarkdown: "# Compact Query Plan",
      reviewScore: 96,
      reviewVerdict: "REFINED",
      reviewCritique: "Approved with Redlock addition",
      identifiedIssues: ["Missing lock"],
      improvementsApplied: ["Added Redlock"],
      tokenReductionPercent: 72,
    });

    expect(plan.id).toBeDefined();
    expect(plan.reviewScore).toBe(96);
    expect(plan.reviewVerdict).toBe("REFINED");
    expect(plan.tokenReductionPercent).toBe(72);
    expect(plan.artifactPath).toBeDefined();

    // Verify artifact file actually exists on disk
    expect(fs.existsSync(plan.artifactPath!)).toBe(true);
    const diskContent = fs.readFileSync(plan.artifactPath!, "utf8");
    expect(diskContent).toContain("# Query Optimization Plan");

    const retrieved = store.getLatestPlan();
    expect(retrieved?.compactMarkdown).toBe("# Compact Query Plan");
    expect(retrieved?.reviewScore).toBe(96);
  });

  it("should track and switch active plan via active-plan.json", () => {
    const p1 = store.savePlan({
      task: "Task 1",
      source: "cli",
      model: "gemini-3.6-flash",
      title: "Plan 1",
      summary: "Summary 1",
      phases: [],
      rawMarkdown: "# Plan 1",
    });

    const p2 = store.savePlan({
      task: "Task 2",
      source: "web",
      model: "gemini-3.6-flash",
      title: "Plan 2",
      summary: "Summary 2",
      phases: [],
      rawMarkdown: "# Plan 2",
    });

    // By default, latest saved plan is active
    expect(store.getActivePlan()?.id).toBe(p2.id);

    // Switch active plan to p1
    const switched = store.setActivePlan(p1.id);
    expect(switched?.id).toBe(p1.id);
    expect(store.getActivePlan()?.id).toBe(p1.id);

    // Can lookup by ID
    expect(store.getPlanById(p2.id)?.title).toBe("Plan 2");
    expect(store.getPlanById("non-existent")).toBeNull();
  });
});

