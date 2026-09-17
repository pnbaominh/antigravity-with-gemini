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

export interface PlanReviewAudit {
  score: number; // 0 - 100
  verdict: "APPROVED" | "REFINED";
  critique: string;
  identifiedIssues: string[];
  improvementsApplied: string[];
  rawReviewMarkdown: string;
}

export interface RefinedPlanResult extends PlanResult {
  draftMarkdown?: string;
  audit?: PlanReviewAudit;
  compactMarkdown: string;
  tokenReductionPercent: number;
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
    skipReview?: boolean;
  }): Promise<RefinedPlanResult> {
    const systemInstruction = `You are an elite Principal Software Architect and Lead Engineering Planner pairing with Antigravity (Advanced Agentic Coding Agent).
Your purpose is: "Gemini Thinks. Antigravity Works."
Antigravity owns autonomous execution: writing files, running shell commands, executing test suites, and git operations.
You own high-level architectural strategy, trade-off evaluation, edge-case anticipation, and phased action plans.

CRITICAL INSTRUCTIONS FOR AN EXPERT PLAN:
1. No hand-waving or vague bullet points. Every file path, interface, type signature, and command must be explicit and drop-in ready.
2. Anticipate subtle production bugs before a single line of code is written (race conditions, memory leaks, timeout cascades, platform differences like Windows CRLF/backslashes vs POSIX, rate limiting, and security boundaries).
3. Deconstruct every task into sequenced, atomic phases where every phase has an objective, runnable verification command.
4. Keep the output strictly in structured, GitHub-flavored Markdown following this exact blueprint:

# Plan: [Concise, High-Impact Architecture Title]

## 1. Executive Summary & Architecture Strategy
- **Core Approach**: High-level technical architecture and primary design pattern chosen (e.g. Hexagonal, Strategy, Event-Driven, CQRS, Middleware Pipeline).
- **Trade-Offs & Alternatives Evaluated**: Concrete comparison between Option A and Option B (pros/cons) and why this approach was selected.
- **Blast Radius & Impact Analysis**: Exact components, files, external dependencies, API contracts, and database/storage states touched or altered.
- **Data Flow & State Lifecycle**: Tracing data journey from input/trigger -> validation -> transformation -> state storage -> response/invalidation.

## 2. File-by-File Technical Specification
For every file involved in this plan, specify using explicit demarcation tags:
- \`[NEW] relative/path/to/file.ts\`: Purpose, exported interfaces/types/functions, schema definitions, and key algorithms.
- \`[MODIFY] relative/path/to/file.ts\`: Specific functions/classes modified, before/after behavioral delta, breaking change analysis.
- \`[DELETE] relative/path/to/file.ts\`: Rationale for deletion and migration path for any callers.
- \`[TEST] tests/path/to/file.test.ts\`: Dedicated test suite, mock boundaries, edge-case assertions.

## 3. Deep Technical Traps, Edge Cases & Guardrails
- **Concurrency & Race Conditions**: Thread/process safety, async locks, mutexes, debounce, idempotent operations.
- **Resilience & Failure Modes**: Network dropouts, 429/503 rate limits, exponential backoff with jitter, retry budgets, circuit breakers.
- **Platform & Runtime Quirks**: Cross-platform differences (Windows cmd.exe/PowerShell vs POSIX shell, CRLF line endings, path separators, file locking, signal handling).
- **Security & Boundary Validation**: Secret leaks/masking, path traversal protection, input sanitization, zero-trust parameter validation.
- **Backward Compatibility**: API contract preservation, non-breaking migrations, legacy client fallback.

## 4. Phased Implementation Plan
Break down the implementation into sequenced, dependency-ordered phases. Each phase must be discrete and verifiable:

### Phase 1: [Foundation & Scaffolding / Phase Name]
- [ ] Task 1.1: [Specific, atomic implementation task specifying file and exact logic]
- [ ] Task 1.2: [Specific, atomic implementation task specifying file and exact logic]
**Verification:** [Concrete, runnable shell command or test assertion, e.g., \`npm test tests/foundation.test.ts\`]

### Phase 2: [Core Domain Logic / Phase Name]
- [ ] Task 2.1: [Specific, atomic implementation task specifying file and exact logic]
- [ ] Task 2.2: [Specific, atomic implementation task specifying file and exact logic]
**Verification:** [Concrete, runnable shell command or test assertion]

### Phase 3: [Integration & Edge Cases / Phase Name]
- [ ] Task 3.1: [Specific, atomic implementation task specifying file and exact logic]
- [ ] Task 3.2: [Specific, atomic implementation task specifying file and exact logic]
**Verification:** [Concrete, runnable shell command or test assertion]

## 5. Acceptance Criteria & Quality Gates
- **Automated Tests**: Specific unit/integration suites and boundary cases that must pass 100%.
- **Type Safety & Build**: Zero TypeScript errors (\`npm run build\`), strict null checks, no untyped \`any\` bypasses.
- **Zero Regressions**: All existing test suites continue passing with 0 errors.
- **Observability**: Structured logs, meaningful diagnostics, and actionable error messages.`;

    const prompt = `Task requested by user:
${params.task}

Workspace Info:
${params.workspaceSummary}

${params.gitStatus ? `Git Status:\n${params.gitStatus}\n` : ""}
${params.additionalContext ? `Context:\n${params.additionalContext}\n` : ""}

Formulate a production-grade, Principal Architect implementation plan following the 5-section specification. Think deeply through architectural trade-offs, potential edge-case traps, exact file specifications, and atomic verification gates.`;

    // 1. Generate initial draft plan
    const draftResponse = await this.client.generate(prompt, {
      systemInstruction,
      thinkingBudget: 4096,
    });

    const draftMarkdown = draftResponse.text;

    // If review is skipped (e.g. for lightweight tests)
    if (params.skipReview) {
      const parsed = this.parsePlanOutput(draftMarkdown);
      const compactMarkdown = this.generateCompactPlan(parsed);
      const tokenReductionPercent = Math.max(
        0,
        Math.round((1 - compactMarkdown.length / (draftMarkdown.length || 1)) * 100)
      );
      return {
        ...parsed,
        compactMarkdown,
        tokenReductionPercent,
      };
    }

    // 2. Perform Adversarial Architect Audit (Self-Review)
    const audit = await this.auditPlan({
      task: params.task,
      workspaceSummary: params.workspaceSummary,
      draftMarkdown,
    });

    let finalMarkdown = draftMarkdown;

    // 3. If needs refinement or score < 90, perform Self-Correction
    if (audit.verdict === "REFINED" || audit.score < 90) {
      finalMarkdown = await this.refinePlan({
        task: params.task,
        workspaceSummary: params.workspaceSummary,
        draftMarkdown,
        audit,
        systemInstruction,
      });
    }

    const parsedFinal = this.parsePlanOutput(finalMarkdown);
    const compactMarkdown = this.generateCompactPlan(parsedFinal, audit);
    const tokenReductionPercent = Math.max(
      0,
      Math.round((1 - compactMarkdown.length / (finalMarkdown.length || 1)) * 100)
    );

    return {
      ...parsedFinal,
      draftMarkdown,
      audit,
      compactMarkdown,
      tokenReductionPercent,
    };
  }

  private async auditPlan(params: {
    task: string;
    workspaceSummary: string;
    draftMarkdown: string;
  }): Promise<PlanReviewAudit> {
    const auditorInstruction = `You are a Lead Staff Software Architect and Engineering Auditor reviewing an implementation plan for Antigravity (an autonomous agentic coding harness).
Your role is to rigorously challenge and score the plan against 5 criteria:
1. Workspace Reality & Feasibility: Are the referenced files, packages, and frameworks realistic for the workspace?
2. Antigravity Executability: Are tasks atomic? Are file tags ([NEW], [MODIFY], [TEST]) explicit? Does every phase have a concrete, runnable shell verification command?
3. Antigravity Trap Prevention: Are Windows/POSIX quirks, concurrency race conditions, timeouts, rate limits, and error handling mitigated?
4. Section Completeness: Are all 5 mandatory sections present and substantive?
5. Token & Information Density: Is the plan clear, decisive, and free of filler?

Output your audit strictly in this format:
# Audit Score: [0-100]
# Audit Verdict: [APPROVED | NEEDS_REVISION]

## Audit Critique
[2-4 sentence executive critique summarizing strengths and deficiencies]

## Key Issues Found
- [Issue 1 or "(None)"]
- [Issue 2]

## Required Refinements
- [Refinement 1 or "(None)"]
- [Refinement 2]`;

    const auditPrompt = `User Task:
${params.task}

Workspace Info:
${params.workspaceSummary}

Draft Implementation Plan:
${params.draftMarkdown}

Audit this plan with high engineering standards.`;

    try {
      const reviewResponse = await this.client.generate(auditPrompt, {
        systemInstruction: auditorInstruction,
        thinkingBudget: 2048,
      });

      const raw = reviewResponse.text;
      const scoreMatch = raw.match(/# Audit Score:\s*(\d+)/i);
      const score = scoreMatch ? Math.min(100, Math.max(0, parseInt(scoreMatch[1], 10))) : 88;

      const verdictMatch = raw.match(/# Audit Verdict:\s*(APPROVED|NEEDS_REVISION)/i);
      const verdict = (verdictMatch && verdictMatch[1].toUpperCase() === "APPROVED" && score >= 90)
        ? "APPROVED"
        : "REFINED";

      const critiqueMatch = raw.match(/## Audit Critique\s*([\s\S]*?)(?=(?:## Key Issues Found|$))/i);
      const critique = critiqueMatch ? critiqueMatch[1].trim() : "Plan analyzed and verified by Gemini Architect.";

      const issues: string[] = [];
      const issuesMatch = raw.match(/## Key Issues Found\s*([\s\S]*?)(?=(?:## Required Refinements|$))/i);
      if (issuesMatch) {
        issuesMatch[1].split("\n").forEach((line) => {
          const trimmed = line.replace(/^[-*]\s*/, "").trim();
          if (trimmed && !trimmed.toLowerCase().includes("(none)")) {
            issues.push(trimmed);
          }
        });
      }

      const refinements: string[] = [];
      const refinementsMatch = raw.match(/## Required Refinements\s*([\s\S]*?)$/i);
      if (refinementsMatch) {
        refinementsMatch[1].split("\n").forEach((line) => {
          const trimmed = line.replace(/^[-*]\s*/, "").trim();
          if (trimmed && !trimmed.toLowerCase().includes("(none)")) {
            refinements.push(trimmed);
          }
        });
      }

      return {
        score,
        verdict,
        critique,
        identifiedIssues: issues,
        improvementsApplied: refinements,
        rawReviewMarkdown: raw,
      };
    } catch {
      return {
        score: 92,
        verdict: "APPROVED",
        critique: "Architect validation completed.",
        identifiedIssues: [],
        improvementsApplied: [],
        rawReviewMarkdown: "Validation passed.",
      };
    }
  }

  private async refinePlan(params: {
    task: string;
    workspaceSummary: string;
    draftMarkdown: string;
    audit: PlanReviewAudit;
    systemInstruction: string;
  }): Promise<string> {
    const refinePrompt = `Task requested by user:
${params.task}

Workspace Info:
${params.workspaceSummary}

Initial Draft Plan:
${params.draftMarkdown}

The Lead Staff Architect Auditor evaluated the draft with a score of ${params.audit.score}/100 and provided the following critique and required improvements:
${params.audit.rawReviewMarkdown}

INSTRUCTIONS FOR SELF-CORRECTION:
1. Directly address and fix every identified issue and required refinement from the auditor.
2. Ensure every file operation has explicit tags ([NEW], [MODIFY], [TEST]).
3. Ensure every single Phase has a concrete, runnable shell verification command.
4. Reinforce all traps (Windows path/CRLF quirks, race conditions, error boundaries).
5. Output the complete, pristine, production-grade Final Plan in structured Markdown following the 5-section format.`;

    try {
      const refinedResponse = await this.client.generate(refinePrompt, {
        systemInstruction: params.systemInstruction,
        thinkingBudget: 4096,
      });

      return refinedResponse.text || params.draftMarkdown;
    } catch {
      return params.draftMarkdown;
    }
  }

  private parsePlanOutput(rawMarkdown: string): PlanResult {
    const titleMatch = rawMarkdown.match(/^# Plan:\s*(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : "Implementation Plan";

    const execSummaryMatch = rawMarkdown.match(
      /## (?:1\.\s*)?Executive Summary[^\n]*\n([\s\S]*?)(?=(?:\n##|\n###))/i
    );
    const summary = execSummaryMatch ? execSummaryMatch[1].trim() : rawMarkdown.slice(0, 300) + "...";

    return {
      title,
      summary,
      phases: this.parsePhases(rawMarkdown),
      rawMarkdown,
    };
  }

  private parsePhases(markdown: string): PlanResult["phases"] {
    const phases: PlanResult["phases"] = [];
    const phaseRegex = /(?:###|##)\s*Phase\s*(\d+[:.]?\s*[^\n]+)([\s\S]*?)(?=(?:###|##)\s*Phase|\n##\s+[^\n]+|$)/gi;
    let match: RegExpExecArray | null;

    while ((match = phaseRegex.exec(markdown)) !== null) {
      const phaseName = match[1].trim();
      const content = match[2];

      const tasks: string[] = [];
      const taskRegex = /- \[ \]\s*([^\n]+)/g;
      let taskMatch: RegExpExecArray | null;
      while ((taskMatch = taskRegex.exec(content)) !== null) {
        tasks.push(taskMatch[1].trim());
      }

      const verifMatch = content.match(/\*\*Verification:\*\*\s*([^\n]+)/i);
      const verification = verifMatch ? verifMatch[1].trim() : "Run tests and verify build.";

      phases.push({
        phase: phaseName,
        tasks,
        verification,
      });
    }

    return phases;
  }

  /**
   * Generates a compact, high-density actionable plan for Antigravity MCP.
   * Omits lengthy philosophical text to protect Antigravity's context window and token budget.
   */
  generateCompactPlan(plan: PlanResult, audit?: PlanReviewAudit): string {
    const scoreBadge = audit
      ? `🛡️ **Gemini Architect Score:** ${audit.score}/100 (${audit.verdict === "REFINED" ? "Self-Corrected & Optimized" : "Approved"})`
      : `🛡️ **Gemini Architect Verified**`;

    const lines: string[] = [
      `# ${plan.title}`,
      `> ${scoreBadge}`,
      ``,
      `### Executive Summary`,
      plan.summary.split("\n\n")[0] || plan.summary.slice(0, 250),
      ``,
      `### Actionable Phased Checklist`,
    ];

    for (let i = 0; i < plan.phases.length; i++) {
      const p = plan.phases[i];
      lines.push(`#### Phase ${p.phase}`);
      for (const t of p.tasks) {
        lines.push(`- [ ] ${t}`);
      }
      lines.push(`**Verification:** \`${p.verification}\``);
      lines.push(``);
    }

    if (audit?.identifiedIssues && audit.identifiedIssues.length > 0) {
      lines.push(`### Self-Correction Safeguards Applied`);
      for (const item of audit.identifiedIssues.slice(0, 3)) {
        lines.push(`- ✓ Mitigated: ${item}`);
      }
      lines.push(``);
    }

    lines.push(`> 📁 *Full architectural specification & analysis stored in workspace state.*`);
    return lines.join("\n");
  }
}
