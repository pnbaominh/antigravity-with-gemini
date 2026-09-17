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
});
