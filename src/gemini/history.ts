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
  compactMarkdown?: string;
  draftMarkdown?: string;
  reviewScore?: number;
  reviewVerdict?: "APPROVED" | "REFINED";
  reviewCritique?: string;
  identifiedIssues?: string[];
  improvementsApplied?: string[];
  tokenReductionPercent?: number;
  artifactPath?: string;
  additionalContext?: string;
}

export class PlanHistoryStore {
  private workspaceRoot: string;
  private filePath: string;
  private plansDir: string;
  private activePlanPath: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    const dir = getWorkspaceStateDirectory(workspaceRoot);
    this.filePath = path.join(dir, "plans_history.json");
    this.plansDir = path.join(this.workspaceRoot, ".g2a", "plans");
    this.activePlanPath = path.join(this.workspaceRoot, ".g2a", "active-plan.json");
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

  getPlanById(id: string): StoredPlan | null {
    const plans = this.getPlans(100);
    return plans.find((p) => p.id === id) || null;
  }

  getLatestPlan(): StoredPlan | null {
    const plans = this.getPlans();
    return plans.length > 0 ? plans[plans.length - 1] : null;
  }

  getActivePlan(): StoredPlan | null {
    try {
      if (fs.existsSync(this.activePlanPath)) {
        const activeMeta = JSON.parse(fs.readFileSync(this.activePlanPath, "utf8"));
        if (activeMeta && activeMeta.id) {
          const plan = this.getPlanById(activeMeta.id);
          if (plan) return plan;
        }
      }
    } catch {
      // Fallback
    }
    return this.getLatestPlan();
  }

  setActivePlan(id: string): StoredPlan | null {
    const plan = this.getPlanById(id);
    if (!plan) return null;

    try {
      const activeMeta = {
        id: plan.id,
        timestamp: plan.timestamp,
        title: plan.title,
        task: plan.task,
        totalPhases: plan.phases.length,
        artifactPath: plan.artifactPath,
        reviewScore: plan.reviewScore,
        reviewVerdict: plan.reviewVerdict,
      };
      fs.mkdirSync(path.dirname(this.activePlanPath), { recursive: true });
      fs.writeFileSync(this.activePlanPath, JSON.stringify(activeMeta, null, 2), "utf8");
    } catch {
      // Non-fatal
    }
    return plan;
  }

  savePlan(plan: Omit<StoredPlan, "id" | "timestamp">): StoredPlan {
    const plans = this.getPlans(50);
    const id = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let artifactPath: string | undefined;

    // Export artifact markdown file to workspace .g2a/plans/
    try {
      fs.mkdirSync(this.plansDir, { recursive: true });
      const planFile = path.join(this.plansDir, `${id}.md`);
      fs.writeFileSync(planFile, plan.rawMarkdown, "utf8");
      artifactPath = planFile;
    } catch {
      // Non-fatal if workspace directory is read-only
    }

    const stored: StoredPlan = {
      id,
      timestamp: Date.now(),
      artifactPath,
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

    // Automatically set as active plan
    try {
      const activeMeta = {
        id: stored.id,
        timestamp: stored.timestamp,
        title: stored.title,
        task: stored.task,
        totalPhases: stored.phases.length,
        artifactPath: stored.artifactPath,
        reviewScore: stored.reviewScore,
        reviewVerdict: stored.reviewVerdict,
      };
      fs.mkdirSync(path.dirname(this.activePlanPath), { recursive: true });
      fs.writeFileSync(this.activePlanPath, JSON.stringify(activeMeta, null, 2), "utf8");
    } catch {
      // Non-fatal
    }

    return stored;
  }
}
