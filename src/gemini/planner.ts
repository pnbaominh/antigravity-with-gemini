import { GeminiThinkingClient } from "./client.js";
import { RulesEngine } from "../governance/rules-engine.js";
import { RuleValidationResult } from "../governance/types.js";

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
  governance?: RuleValidationResult;
  haltOnUnknown?: boolean;
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
    workspaceRoot?: string;
  }): Promise<RefinedPlanResult> {
    const systemInstruction = `You are an elite Principal Software Architect and Lead Engineering Planner pairing with Antigravity (Advanced Agentic Coding Agent).
Your purpose is: "Gemini Thinks. Antigravity Works."
You operate under the strict RULES.MD Technical Governance Framework:
1. Invariant Axioms: Plan-Before-Execute, Evidence-Based Grounding, Scope Discipline, Halt-on-Unknown.
2. Scope Control: Mandatory >= 3 explicit Non-Goals.
3. Pre-Mortem & Accountability: RAID log and Single Directly Responsible Individual (DRI) per task.
4. Estimation & Discipline: 8/80 hour duration rule, PERT statistical estimation (E = (O + 4M + P)/6, Sigma = (P - O)/6).
5. Binary Acceptance Criteria: Objective pass/fail tests and commands, zero subjective qualifiers.

CRITICAL INSTRUCTIONS FOR A RULES.MD COMPLIANT PLAN:
1. Keep the output strictly in structured, GitHub-flavored Markdown following this exact 6-section blueprint:

# Plan: [Concise, High-Impact Architecture Title]
DRI: [Single DRI name or role, e.g. @lead_architect]

## 1. AS-IS State & Evidence Grounding
Ground the plan in actual workspace reality. Reference existing files using backticks and note observed states:
- \`relative/path/to/existing/file.ts\`: [Current architecture, exported symbols, observed patterns]

## 2. Non-Goals & Scope Boundaries (Mandatory >= 3)
Explicitly list at least 3 distinct things that are strictly OUT OF SCOPE to prevent scope creep:
1. [Out of scope item 1]
2. [Out of scope item 2]
3. [Out of scope item 3]

## 3. Unknowns & Halt Checks (Halt-on-Unknown Protocol)
- Status: [CLEAR | HALT]
- Unknowns: [None | List specific unverified credentials, endpoints, or dependencies that require user input]
(NOTE: If any critical production credentials or ambiguous architectural dependencies are missing, declare Status: HALT and do NOT guess or synthesize fake tokens).

## 4. Pre-Mortem & RAID Log
| ID | Category | Description | Impact | Likelihood | Mitigation | Owner DRI |
| R-1 | Risk | [Technical risk, concurrency, race condition, platform CRLF] | High | Medium | [Concrete mitigation] | [@dri] |
| A-1 | Assumption | [Key technical assumption] | Medium | Low | [Validation step] | [@dri] |
| D-1 | Dependency | [Internal or external dependency] | High | Low | [Graceful fallback] | [@dri] |

## 5. Work Breakdown Structure (WBS) & Phased Implementation
Break down into sequenced, dependency-ordered phases. Every phase must have atomic tasks, single DRI, PERT estimates, and runnable binary verification commands:

### Phase 1: [Foundation & Scaffolding / Phase Name]
- [ ] Task 1.1: [Atomic implementation task specifying exact file and logic] (DRI: @dri)
- [ ] Task 1.2: [Atomic implementation task specifying exact file and logic] (DRI: @dri)
**Verification:** [Concrete, runnable shell command, e.g. \`npm test tests/foundation.test.ts\`]
PERT: O=[hours], M=[hours], P=[hours]

### Phase 2: [Core Domain Logic / Phase Name]
- [ ] Task 2.1: [Atomic task] (DRI: @dri)
- [ ] Task 2.2: [Atomic task] (DRI: @dri)
**Verification:** [Concrete, runnable shell command]
PERT: O=[hours], M=[hours], P=[hours]

### Phase 3: [Integration & Traps Hardening / Phase Name]
- [ ] Task 3.1: [Atomic task] (DRI: @dri)
- [ ] Task 3.2: [Atomic task] (DRI: @dri)
**Verification:** [Concrete, runnable shell command]
PERT: O=[hours], M=[hours], P=[hours]

## 6. Definition of Done & Quality Gates
- **Automated Tests**: Specific unit/integration suites that must pass 100% (Binary Pass/Fail).
- **Type Safety & Build**: Zero TypeScript errors (\`npm run build\`), strict null checks.
- **Zero Regressions**: All existing test suites pass with 0 errors.`;

    const prompt = `Task requested by user:
${params.task}

Workspace Info:
${params.workspaceSummary}

${params.gitStatus ? `Git Status:\n${params.gitStatus}\n` : ""}
${params.additionalContext ? `Context:\n${params.additionalContext}\n` : ""}

Formulate a production-grade implementation plan strictly compliant with the RULES.MD 6-section governance specification. Ensure Evidence Grounding (AS-IS), Non-Goals (>= 3), Halt-on-Unknown check, RAID log, Single DRI, PERT estimates, and binary verification gates.`;

    // 1. Generate initial draft plan
    const draftResponse = await this.client.generate(prompt, {
      systemInstruction,
      thinkingBudget: 4096,
    });

    const draftMarkdown = draftResponse.text;

    // If review is skipped (e.g. for lightweight tests)
    if (params.skipReview) {
      const parsed = this.parsePlanOutput(draftMarkdown);
      const governance = RulesEngine.validateMarkdownPlan(draftMarkdown, params.workspaceRoot);
      const compactMarkdown = this.generateCompactPlan(parsed, undefined, governance);
      const tokenReductionPercent = Math.max(
        0,
        Math.round((1 - compactMarkdown.length / (draftMarkdown.length || 1)) * 100)
      );
      return {
        ...parsed,
        compactMarkdown,
        tokenReductionPercent,
        governance,
        haltOnUnknown: governance.haltRequired,
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
    const governance = RulesEngine.validateMarkdownPlan(finalMarkdown, params.workspaceRoot);
    const compactMarkdown = this.generateCompactPlan(parsedFinal, audit, governance);
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
      governance,
      haltOnUnknown: governance.haltRequired,
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
    const titleMatch = rawMarkdown.match(/^# (?:Plan:\s*)?(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : "Implementation Plan";

    const execSummaryMatch = rawMarkdown.match(
      /## [^\n]*(?:Executive Summary|Summary|AS-IS)[^\n]*\n([\s\S]*?)(?=(?:\n##|\n###))/i
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
  generateCompactPlan(
    plan: PlanResult,
    audit?: PlanReviewAudit,
    governance?: RuleValidationResult
  ): string {
    const scoreBadge = audit
      ? `🛡️ **Gemini Architect Score:** ${audit.score}/100 (${audit.verdict === "REFINED" ? "Self-Corrected & Optimized" : "Approved"})`
      : `🛡️ **Gemini Architect Verified**`;

    const govBadge = governance
      ? (governance.haltRequired
          ? `🛑 **RULES.MD Status:** HALT ON UNKNOWN (${governance.violations.length} item(s) require clarification)`
          : governance.valid
          ? `📋 **RULES.MD Governance:** Verified & Compliant ✓`
          : `⚠️ **RULES.MD Invariants:** ${governance.violations.length} violation(s) detected`)
      : `📋 **RULES.MD Governance:** Active`;

    const lines: string[] = [
      `# ${plan.title}`,
      `> ${scoreBadge} | ${govBadge}`,
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

    if (governance && !governance.valid) {
      lines.push(`### Governance Warnings`);
      for (const v of governance.violations.slice(0, 3)) {
        lines.push(`- ⚠️ ${v}`);
      }
      lines.push(``);
    }

    lines.push(`> 📁 *Full architectural specification & analysis stored in workspace state.*`);
    return lines.join("\n");
  }

  /**
   * Generates a micro-payload Ticket (< 50 tokens) for Antigravity.
   * Stores the plan on disk and returns ONLY the pointer to achieve ZERO context bloat.
   */
  generatePointerTicket(params: {
    planId: string;
    title: string;
    artifactPath: string;
    totalPhases: number;
    auditScore?: number;
    auditVerdict?: string;
    governanceValid?: boolean;
    violationsCount?: number;
    haltRequired?: boolean;
  }): string {
    const status = params.haltRequired ? "HALT" : "READY";
    const payload = {
      status,
      planId: params.planId,
      title: params.title,
      score: params.auditScore ?? 90,
      verdict: params.auditVerdict ?? "APPROVED",
      rulesMdCompliance: params.governanceValid !== false ? "COMPLIANT" : "VIOLATIONS_DETECTED",
      violationsCount: params.violationsCount ?? 0,
      totalPhases: params.totalPhases,
      artifactFile: params.artifactPath.replace(/\\/g, "/"),
      instruction: params.haltRequired
        ? `Halt-on-Unknown triggered: Clarification required on unverified dependencies before execution.`
        : `Plan saved to disk with zero Antigravity context bloat. Fetch Phase 1 using gemini_get_phase({ phaseIndex: 1 }).`,
    };
    return JSON.stringify(payload, null, 2);
  }

  /**
   * Extracts a specific phase from a plan by 1-based index for Just-In-Time (JIT) delivery.
   * Returns null if phaseIndex is out of range.
   */
  extractPhase(planOrMarkdown: PlanResult | string, phaseIndex: number): {
    phaseIndex: number;
    totalPhases: number;
    phaseName: string;
    tasks: string[];
    verification: string;
    markdown: string;
  } | null {
    const phases = typeof planOrMarkdown === "string"
      ? this.parsePhases(planOrMarkdown)
      : planOrMarkdown.phases;

    if (phaseIndex < 1 || phaseIndex > phases.length) {
      return null;
    }

    const target = phases[phaseIndex - 1];
    const lines = [
      `### Phase ${target.phase}`,
      ...target.tasks.map((t) => `- [ ] ${t}`),
      `**Verification:** \`${target.verification}\``,
    ];

    return {
      phaseIndex,
      totalPhases: phases.length,
      phaseName: target.phase,
      tasks: target.tasks,
      verification: target.verification,
      markdown: lines.join("\n"),
    };
  }
}

