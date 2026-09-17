import { GeminiThinkingClient } from "./client.js";

export interface PlanResult {
  title: string;
  summary: string;
  phases: Array<{
    phase: string;
    tasks: string[];
    verification: string;
  }>;
  rawMarkdown: string;
}

export class GeminiPlanner {
  private client: GeminiThinkingClient;

  constructor(client: GeminiThinkingClient) {
    this.client = client;
  }

  async createPlan(params: {
    task: string;
    workspaceSummary: string;
    gitStatus?: string;
    additionalContext?: string;
  }): Promise<PlanResult> {
    const systemInstruction = `You are the master planning brain for Antigravity (Advanced Agentic Coding Agent).
Your purpose is: Gemini thinks. Antigravity works.
Antigravity owns code editing, running shell commands, executing tests, and git operations.
You own high-level reasoning, architectural analysis, edge-case anticipation, and phased action plans.

Format your response strictly as structured Markdown with:
# Plan: [Brief Title]
## Executive Summary
[1-2 paragraphs of technical reasoning, architecture decisions, and potential traps]

## Phase 1: [Phase Name]
- [ ] Task 1.1: [Specific, atomic action]
- [ ] Task 1.2: [Specific, atomic action]
**Verification:** [Objective command or criteria to verify this phase]

## Phase 2: [Phase Name]
- [ ] Task 2.1: [Specific, atomic action]
- [ ] Task 2.2: [Specific, atomic action]
**Verification:** [Objective command or criteria to verify this phase]

## Acceptance & Quality Checklist
- [ ] Checklist item 1
- [ ] Checklist item 2`;

    const prompt = `Task requested by user:
${params.task}

Workspace Info:
${params.workspaceSummary}

${params.gitStatus ? `Git Status:\n${params.gitStatus}\n` : ""}
${params.additionalContext ? `Context:\n${params.additionalContext}\n` : ""}

Think deeply about edge cases, existing conventions, test coverage, and break down the solution into an actionable, phased plan for Antigravity.`;

    const response = await this.client.generate(prompt, {
      systemInstruction,
      thinkingBudget: 8192,
    });

    const rawMarkdown = response.text;
    const titleMatch = rawMarkdown.match(/^# Plan:\s*(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : "Implementation Plan";

    return {
      title,
      summary: rawMarkdown.slice(0, 300) + "...",
      phases: this.parsePhases(rawMarkdown),
      rawMarkdown,
    };
  }

  private parsePhases(markdown: string): PlanResult["phases"] {
    const phases: PlanResult["phases"] = [];
    const phaseRegex = /## Phase \d+:\s*([^\n]+)([\s\S]*?)(?=(## Phase|\n## Acceptance|$))/g;
    let match;

    while ((match = phaseRegex.exec(markdown)) !== null) {
      const phaseName = match[1].trim();
      const content = match[2];

      const tasks: string[] = [];
      const taskRegex = /- \[ \] ([^\n]+)/g;
      let taskMatch;
      while ((taskMatch = taskRegex.exec(content)) !== null) {
        tasks.push(taskMatch[1].trim());
      }

      const verifMatch = content.match(/\*\*Verification:\*\*\s*([^\n]+)/);
      const verification = verifMatch ? verifMatch[1].trim() : "Run tests and verify build.";

      phases.push({
        phase: phaseName,
        tasks,
        verification,
      });
    }

    return phases;
  }
}
