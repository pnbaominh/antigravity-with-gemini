import fs from "node:fs";
import path from "node:path";
import { getWorkspaceStateDirectory } from "../config/paths.js";
import { type PlanResult } from "./planner.js";

export interface StoredPlan {
  id: string;
  timestamp: number;
  task: string;
  source: "cli" | "mcp" | "web";
  model: string;
  title: string;
  summary: string;
  phases: PlanResult["phases"];
  rawMarkdown: string;
  additionalContext?: string;
}

export class PlanHistoryStore {
  private filePath: string;

  constructor(workspaceRoot: string) {
    const dir = getWorkspaceStateDirectory(workspaceRoot);
    this.filePath = path.join(dir, "plans_history.json");
  }

  getPlans(limit = 20): StoredPlan[] {
    try {
      if (!fs.existsSync(this.filePath)) {
        return [];
      }
      const data = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return Array.isArray(data) ? data.slice(-limit) : [];
    } catch {
      return [];
    }
  }

  getLatestPlan(): StoredPlan | null {
    const plans = this.getPlans();
    return plans.length > 0 ? plans[plans.length - 1] : null;
  }

  savePlan(plan: Omit<StoredPlan, "id" | "timestamp">): StoredPlan {
    const plans = this.getPlans(50);
    const stored: StoredPlan = {
      id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      ...plan,
    };
    plans.push(stored);

    // Keep up to 50 plans
    const trimmed = plans.slice(-50);
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(trimmed, null, 2), "utf8");
    return stored;
  }
}
