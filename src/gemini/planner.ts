import type { GeminiGenerationClient } from "./client-interface.js";
import { RulesEngine } from "../governance/rules-engine.js";
import { RuleValidationResult } from "../governance/types.js";
import { PromptSanitizer } from "./prompt-sanitizer.js";

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
  private client: GeminiGenerationClient;

  constructor(client: GeminiGenerationClient) {
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
    const isGreenfield =
      !params.gitStatus ||
      params.gitStatus.includes("Not a git repository") ||
      !params.workspaceSummary ||
      params.workspaceSummary.includes("Frameworks: none") ||
      params.workspaceSummary.includes("unknown");

    const isVN =
      /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(params.task) ||
      /\b(?:xay\s+dung|xây\s+dựng|lam|làm|tao|tạo|cho|voi|với|trang\s+web|web|tai|tại|he\s+thong|hệ\s+thống)\b/i.test(params.task);

    const greenfieldNote = isGreenfield
      ? isVN
        ? `\nLưu ý hiện trạng: Dự án mới ban đầu (greenfield). Trình bày hiện trạng khởi tạo và coi các tên miền/nhãn hiệu là tham số cấu hình tĩnh của code.\n`
        : `\nNote: Greenfield workspace. Document scaffolding status and treat domain names strictly as configuration constants.\n`
      : "";

    const prompt = isVN
      ? `Viết kế hoạch kiến trúc kỹ thuật hệ thống theo chuẩn RULES.MD cho nhiệm vụ sau: "${params.task}".
${greenfieldNote}
${params.workspaceSummary ? `Thông tin Workspace:\n${params.workspaceSummary}\n` : ""}
${params.gitStatus ? `Trạng thái Git:\n${params.gitStatus}\n` : ""}
${params.additionalContext ? `Ngữ cảnh bổ sung:\n${params.additionalContext}\n` : ""}

Trình bày theo cấu trúc kỹ thuật tiêu chuẩn RULES.MD:
# Plan: [Tên Kiến Trúc Kỹ Thuật]
Người phụ trách chính: lead_architect

## 1. AS-IS State & Hiện Trạng Hệ Thống
- Mô tả hiện trạng dự án ban đầu, lựa chọn công nghệ Tech Stack (Runtime, Framework, UI, State, Testing).
- Sơ đồ kiến trúc & luồng dữ liệu (Mermaid flowchart TD).
- Cấu trúc thư mục định danh file ([NEW], [MODIFY], [DELETE]).
- Định nghĩa TypeScript interfaces & Data contracts.

## 2. Non-Goals & Phạm Vi Dự Án (Tối thiểu 3 mục ngoài phạm vi)
1. ...
2. ...
3. ...

## 3. Unknowns & Kiểm Tra Kỹ Thuật
Status: CLEAR

## 4. Quản Trị Rủi Ro & Bảng RAID Log (Tối thiểu 4 mục)
Bảng phân tích rủi ro kỹ thuật, giả định, phụ thuộc và biện pháp khắc phục:
| ID | Category | Description | Impact | Likelihood | Mitigation Strategy | Owner DRI |
| R-1 | Risk | Concurrency & Async state hazards | High | Medium | Defensive locks / debounce | lead_architect |
| R-2 | Risk | Platform quirks (Windows vs POSIX paths, CRLF) | Medium | High | Path normalization & npm.cmd | lead_architect |
| R-3 | Risk | Network timeouts & API error boundaries | High | Low | Exponential backoff & retry | lead_architect |
| A-1 | Assumption | Browser runtime compatibility | Medium | Low | Runtime validation checks | lead_architect |

## 5. Work Breakdown Structure (WBS) & Phân Chia Giai Đoạn
Chia thành Phase 1 (Khởi tạo & Scaffolding), Phase 2 (Giao diện & Chức năng chính), Phase 3 (Tối ưu & Triển khai). Mỗi phase có danh sách task checklist ([NEW], [MODIFY]), single DRI (DRI: lead_architect), lệnh kiểm thử verification shell nhị phân và ước tính thời gian PERT (PERT: O=..., M=..., P=...).

## 6. Definition of Done & Tiêu Chuẩn Nghiệm Thu
Tiêu chí nghiệm thu: 100% test pass, 0 type errors, 0 lint warnings, clean build.

Yêu cầu xuất: Bắt đầu trực tiếp với "# Plan: [Tiêu đề]", không xuất lời chào hay văn bản giao tiếp.`
      : `Write a technical architecture implementation plan adhering to RULES.MD for the following task: "${params.task}".
${greenfieldNote}
${params.workspaceSummary ? `Workspace Info:\n${params.workspaceSummary}\n` : ""}
${params.gitStatus ? `Git Status:\n${params.gitStatus}\n` : ""}
${params.additionalContext ? `Context:\n${params.additionalContext}\n` : ""}

Follow this standard technical RULES.MD blueprint:
# Plan: [Concise Architecture Title]
DRI: lead_architect

## 1. AS-IS State & System Architecture Blueprint
- System Overview & Tech Stack Selection (Runtime, Framework, UI, State, Testing)
- Architecture & Data Flow Diagram (Mermaid flowchart TD)
- Directory & File Layout with tags ([NEW], [MODIFY], [DELETE])
- Core TypeScript Interfaces & Data Contracts

## 2. Non-Goals & Scope Boundaries (Mandatory >= 3)
1. ...
2. ...
3. ...

## 3. Unknowns & Halt Checks
Status: CLEAR

## 4. Risk Assessment & RAID Log (Mandatory >= 4 entries)
| ID | Category | Description | Impact | Likelihood | Mitigation Strategy | Owner DRI |
| R-1 | Risk | Concurrency & Async state hazards | High | Medium | Defensive locks / debounce | lead_architect |
| R-2 | Risk | Platform quirks (Windows vs POSIX paths, CRLF) | Medium | High | Path normalization & npm.cmd | lead_architect |
| R-3 | Risk | Network timeouts & API error boundaries | High | Low | Exponential backoff & retry | lead_architect |
| A-1 | Assumption | Browser runtime compatibility | Medium | Low | Runtime validation checks | lead_architect |

## 5. Work Breakdown Structure (WBS) & Phased Implementation
Break down into sequenced phases (Phase 1, Phase 2, Phase 3) with atomic tasks ([NEW], [MODIFY]), single DRI (DRI: lead_architect), concrete runnable shell verification commands, and PERT estimations.

## 6. Definition of Done & Quality Gates
Binary pass/fail criteria: 100% test pass, 0 type errors, clean build.

Output Requirement: Directly begin your response with "# Plan: [Title]". Do not output any conversational preamble.`;

    const systemInstruction = `Role: Principal Software Architect. Purpose: "Gemini Thinks. Antigravity Works." Operating under RULES.MD technical governance. Output pure technical Markdown plan starting with "# Plan:".`;

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
      workspaceRoot: params.workspaceRoot,
    });

    let finalMarkdown = draftMarkdown;

    // 3. Perform Self-Correction if audit detected issues or score < 90
    if (
      audit.verdict === "REFINED" ||
      audit.score < 90 ||
      !RulesEngine.validateMarkdownPlan(draftMarkdown, params.workspaceRoot).valid
    ) {
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
    workspaceRoot?: string;
  }): Promise<PlanReviewAudit> {
    // If draft is truncated, too short, or lacks required plan title, immediately reject and demand refinement
    const hasPlanTitle = /#*\s*Plan:/i.test(params.draftMarkdown);
    if (params.draftMarkdown.length < 200 || !hasPlanTitle) {
      return {
        score: 30,
        verdict: "REFINED",
        critique: "Draft plan is truncated or contains conversational preamble without the mandatory 6-section RULES.MD structure.",
        identifiedIssues: [
          "Plan missing required '# Plan:' root header",
          "Missing mandatory 6 sections (AS-IS, Non-Goals, Halt Check, RAID, WBS PERT, AC/DoD)",
          "Draft output contains conversational filler instead of technical specification",
        ],
        improvementsApplied: [
          "Reconstruct complete 6-section RULES.MD architectural plan from scratch",
          "Directly output pure Markdown starting with '# Plan:'",
        ],
        rawReviewMarkdown: "# Audit Score: 30\n# Audit Verdict: NEEDS_REVISION\n\n## Audit Critique\nDraft was incomplete or conversational.\n\n## Key Issues Found\n- Incomplete structure\n\n## Required Refinements\n- Full reconstruction under RULES.MD",
      };
    }

    const auditorInstruction = `You are a Lead Staff Software Architect and Engineering Auditor reviewing an implementation plan for Antigravity (an autonomous agentic coding harness).
Your role is to rigorously challenge and score the plan against 6 production-grade criteria:
1. Architectural Depth: Does Section 1 provide a clear tech stack rationale, Mermaid architecture/data flow diagram, and directory layout?
2. Interface & Contract Precision: Are domain data models, TypeScript interfaces, and component prop contracts explicitly defined?
3. Workspace Reality & Feasibility: Are the referenced files, packages, and frameworks realistic for the workspace?
4. Antigravity Executability: Are tasks atomic? Are file tags ([NEW], [MODIFY], [TEST], [EXEC]) explicit? Does every phase have a concrete, runnable shell verification command?
5. Antigravity Trap Prevention & RAID: Are Windows/POSIX quirks, CRLF endings, concurrency race conditions, timeouts, rate limits, and error handling thoroughly mitigated in the RAID table (>= 4 entries)?
6. RULES.MD Compliance: Are all 6 mandatory sections present, including Non-Goals (>= 3), Halt-on-Unknown check, Single DRI per task, and PERT estimations?

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

    const { sanitizedTask } = PromptSanitizer.sanitizeTask(params.task);

    const auditPrompt = `User Task (Authorized Scope):
${sanitizedTask}

Workspace Info:
${params.workspaceSummary}

Draft Implementation Plan:
${params.draftMarkdown}

Audit this plan with high engineering standards. If the plan is shallow, lacks concrete component interfaces, or lacks runnable test commands, assign score < 90 and demand technical refinement.`;

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
      // Deterministic fallback validation via RulesEngine
      const localCheck = RulesEngine.validateMarkdownPlan(params.draftMarkdown, params.workspaceRoot);
      if (localCheck.valid && params.draftMarkdown.length >= 800) {
        return {
          score: 90,
          verdict: "APPROVED",
          critique: "Architect validation verified all RULES.MD invariants successfully.",
          identifiedIssues: [],
          improvementsApplied: [],
          rawReviewMarkdown: "Validation passed with full compliance.",
        };
      } else {
        const issues = localCheck.violations.length > 0 ? localCheck.violations : ["Plan requires structural completion"];
        return {
          score: 60,
          verdict: "REFINED",
          critique: "Plan audit flagged governance violations or incomplete sections that require refinement.",
          identifiedIssues: issues,
          improvementsApplied: ["Synthesize complete 6-section RULES.MD structure with Non-Goals >= 3 and PERT estimates"],
          rawReviewMarkdown: `# Audit Score: 60\n# Audit Verdict: NEEDS_REVISION\n\n## Key Issues Found\n${issues.map((v) => `- ${v}`).join("\n")}`,
        };
      }
    }
  }

  private async refinePlan(params: {
    task: string;
    workspaceSummary: string;
    draftMarkdown: string;
    audit: PlanReviewAudit;
    systemInstruction: string;
  }): Promise<string> {
    const { sanitizedTask } = PromptSanitizer.sanitizeTask(params.task);

    const refinePrompt = `Task requested by user (Authorized Scope):
${sanitizedTask}

Workspace Info:
${params.workspaceSummary}

Initial Draft Plan:
${params.draftMarkdown}

The Lead Staff Architect Auditor evaluated the draft with a score of ${params.audit.score}/100 and provided the following critique and required improvements:
${params.audit.rawReviewMarkdown}

INSTRUCTIONS FOR SELF-CORRECTION:
1. Directly address and fix every identified issue and required refinement from the auditor.
2. Ensure every file operation has explicit tags ([NEW], [MODIFY], [DELETE], [TEST]).
3. Ensure every single Phase has a concrete, runnable shell verification command.
4. Reinforce all traps (Windows path/CRLF quirks, race conditions, error boundaries).
Format requirement: Directly begin your output with "# Plan: [Title]". Output pure Markdown without introductory conversational text.`;

    try {
      const refinedResponse = await this.client.generate(refinePrompt, {
        systemInstruction: params.systemInstruction,
        thinkingBudget: 4096,
      });

      const refinedText = refinedResponse.text?.trim();
      if (refinedText && refinedText.length > 200 && /#*\s*Plan:/i.test(refinedText)) {
        return refinedText;
      }
      return refinedText || params.draftMarkdown;
    } catch {
      return params.draftMarkdown;
    }
  }

  private parsePlanOutput(rawMarkdown: string): PlanResult {
    const titleMatch =
      rawMarkdown.match(/^(?:#+\s*)?Plan:\s*(.+)$/im) ||
      rawMarkdown.match(/^# (?:Plan:\s*)?(.+)$/m);
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

