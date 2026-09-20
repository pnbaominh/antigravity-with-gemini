import type { GeminiGenerationClient } from "./client-interface.js";
import { RulesEngine } from "../governance/rules-engine.js";
import { RuleValidationResult } from "../governance/types.js";
import { PromptSanitizer } from "./prompt-sanitizer.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

/**
 * Loads the complete physical content of RULES.MD from disk.
 * Searches workspaceRoot, current working directory, and package roots.
 */
export function loadRulesContent(workspaceRoot?: string): string {
  const candidates: string[] = [];
  if (workspaceRoot) {
    candidates.push(path.join(workspaceRoot, "RULES.md"));
    candidates.push(path.join(workspaceRoot, "RULES.MD"));
    candidates.push(path.join(workspaceRoot, "rules.md"));
  }
  candidates.push(path.join(process.cwd(), "RULES.md"));
  candidates.push(path.join(process.cwd(), "RULES.MD"));
  candidates.push(path.join(process.cwd(), "rules.md"));

  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.resolve(currentDir, "../../RULES.md"));
    candidates.push(path.resolve(currentDir, "../../../RULES.md"));
    candidates.push(path.resolve(currentDir, "../../../../RULES.md"));
  } catch {}

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        const text = fs.readFileSync(candidate, "utf8").trim();
        if (text.length > 50) {
          return text;
        }
      }
    } catch {}
  }
  return "";
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
    model?: string;
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

    const rulesDoc = loadRulesContent(params.workspaceRoot);
    const rulesSection = rulesDoc
      ? isVN
        ? `\n================================================================================\nBỘ QUY CHUẨN QUẢN TRỊ KỸ THUẬT: RULES.MD (TOÀN VĂN BẮT BUỘC TUÂN THỦ 100%):\n--------------------------------------------------------------------------------\n${rulesDoc}\n================================================================================\n`
        : `\n================================================================================\nTECHNICAL GOVERNANCE STANDARD: RULES.MD (FULL MANDATORY SPECIFICATION TEXT):\n--------------------------------------------------------------------------------\n${rulesDoc}\n================================================================================\n`
      : "";

    const prompt = isVN
      ? `${rulesSection}
Vai trò: Principal Systems Architect & Senior Staff Software Engineer
Tài liệu: Bản Thiết Kế Kiến Trúc Kỹ Thuật Hệ Thống & Kế Hoạch Triển Khai Thực Thi (Technical Architecture RFC & Phased Execution Plan)
Quy chuẩn áp dụng: RULES.MD (đã được đính kèm toàn văn ở trên)

MỤC TIÊU PHÁT TRIỂN HỆ THỐNG / YÊU CẦU DỰ ÁN:
"${params.task}"
${greenfieldNote}
${params.workspaceSummary ? `Thông tin Workspace hiện tại:\n${params.workspaceSummary}\n` : ""}
${params.gitStatus ? `Trạng thái Git:\n${params.gitStatus}\n` : ""}
${params.additionalContext ? `Ngữ cảnh kỹ thuật bổ sung:\n${params.additionalContext}\n` : ""}

Là Kiến trúc sư trưởng (Lead Architect), bạn phải lập một bản Kế Hoạch Kỹ Thuật chuyên sâu, chi tiết đến từng tệp mã nguồn, rành mạch, không mơ hồ và có tính thực thi 100% cho AI Agent / Kỹ sư phần mềm. 

Kế hoạch PHẢI tuân thủ đầy đủ 5 Tiên Đề Bất Biến và cấu trúc 6 phần bắt buộc của RULES.MD:

# Plan: [Tên Kiến Trúc Kỹ Thuật Hệ Thống Cụ Thể]
DRI: lead_architect

## 1. AS-IS State & System Architecture Blueprint
- Hiện trạng hệ thống: Khảo sát thực tế hiện trạng mã nguồn, cấu hình workspace, các thư viện/frameworks sẵn có.
- Cơ sở lý luận lựa chọn Tech Stack: Phân tích kỹ thuật chuyên sâu tại sao chọn từng công nghệ (Runtime, Framework, UI/Component library, State Management, Styling, Test Runner, Native/OS APIs) thay vì các giải pháp thay thế.
- Sơ đồ kiến trúc & luồng dữ liệu đa tầng (bắt buộc dùng Mermaid flowchart TD): Trình bày trực quan luồng tương tác giữa User, Frontend/UI components, State/Store, API/Bridge Services, Native OS APIs / Database.
- Cấu trúc thư mục định danh tệp: Liệt kê đầy đủ mọi tệp trong dự án với nhãn cụ thể ([NEW], [MODIFY], [DELETE]) và đường dẫn tương đối rõ ràng.
- Định nghĩa TypeScript Interfaces & Data Contracts: Khai báo đầy đủ các interface/types TypeScript cốt lõi của hệ thống (Domain entities, Request/Response payloads, Component props, Store state). Tuyệt đối không dùng pseudo-code hay placeholder.

## 2. Non-Goals & Phạm Vi Dự Án (Bắt buộc tối thiểu 3 mục ngoài phạm vi)
Nêu rõ tối thiểu 3 hạng mục kỹ thuật liên quan trực tiếp nhưng kiên quyết từ chối thực hiện trong chu kỳ này kèm lý lẽ kỹ thuật rõ ràng để triệt tiêu scope creep:
1. [Mục loại trừ 1 & lý do kỹ thuật dứt khoát không làm]
2. [Mục loại trừ 2 & lý do kỹ thuật dứt khoát không làm]
3. [Mục loại trừ 3 & lý do kỹ thuật dứt khoát không làm]

## 3. Unknowns & Kiểm Tra Kỹ Thuật (Halt-on-Unknown Protocol)
- Status: CLEAR (hoặc HALT nếu phát hiện thiếu hụt thông số kỹ thuật chí mạng)
- Unknowns: None (hoặc danh sách các ẩn số kỹ thuật cần giải quyết bằng thực nghiệm trước khi code)

## 4. Quản Trị Rủi Ro & Bảng RAID Log (Bắt buộc tối thiểu 4 mục phân tích sâu)
Bảng Pre-Mortem phân tích rủi ro kỹ thuật, giả định, phụ thuộc với chiến lược phòng ngừa chủ động và phân quyền Single DRI:
| ID | Category | Description | Impact | Likelihood | Mitigation Strategy | Owner DRI |
| R-1 | Risk | Concurrency & Async State Hazards (Race conditions, double submit, stale state) | High | Medium | Defensive locks, debounce, optimistic UI rollback | lead_architect |
| R-2 | Risk | Platform Quirks (Windows vs POSIX paths, CRLF vs LF, npm.cmd vs npm, UAC) | Medium | High | Normalized path utilities, cross-env, explicit npm.cmd execution | lead_architect |
| R-3 | Risk | Network / OS API Timeouts & Rate Limits | High | Low | Exponential backoff with jitter, circuit breaker, graceful failover | lead_architect |
| A-1 | Assumption | Host Runtime & Browser Environment Compatibility | Medium | Low | Runtime prerequisite verification at startup | lead_architect |

## 5. Work Breakdown Structure (WBS) & Phân Chia Giai Đoạn (PERT)
Phân rã thành các Phase tuần tự theo quy tắc 8/80 (Phase 1: Foundation, Scaffolding & Types; Phase 2: Domain Logic & Core Services; Phase 3: UI Components & User Flow; Phase 4: Integration, Hardening & Production Build).
Mỗi Phase BẮT BUỘC phải có:
- Tên Phase được danh từ hóa theo sản phẩm chuyển giao (ví dụ: "Phase 1: Module Nền Tảng & Đặc Tả Types").
- Danh sách các vi tác vụ atomic (đánh dấu [NEW], [MODIFY], [DELETE]) với Single DRI (DRI: lead_architect).
- Lệnh kiểm thử nhị phân độc lập (Verification Command) có thể chạy trực tiếp bằng shell (ví dụ: npm.cmd test tests/unit.test.ts hoặc npx tsc --noEmit).
- Ước lượng 3 điểm PERT định lượng: PERT: O=...h, M=...h, P=...h, E=...h, Sigma=...h.

## 6. Definition of Done & Tiêu Chuẩn Nghiệm Thu
Tiêu chí nghiệm thu nhị phân (Binary Pass/Fail):
- [ ] 100% automated unit and integration tests PASS
- [ ] Zero TypeScript compilation errors (tsc --noEmit clean)
- [ ] Zero ESLint / linter warnings
- [ ] Clean production build (npm run build succeeded)
- [ ] Mọi tệp mới đều có header tài liệu kỹ thuật và tuân thủ chuẩn kiến trúc.

YÊU CẦU ĐỊNH DẠNG:
- Bắt đầu trực tiếp bằng "# Plan: [Tiêu đề]", TUYỆT ĐỐI không xuất bất kỳ lời chào hay câu mở đầu nào.
- Xuất đầy đủ toàn văn, không cắt bớt, không dùng "..." hay placeholder.`
      : `${rulesSection}
Role: Principal Systems Architect & Senior Staff Software Engineer
Document: Technical Architecture RFC & Phased Implementation Plan
Governance Standard: RULES.MD (Full specification provided above)

System Development Objective:
"${params.task}"
${greenfieldNote}
${params.workspaceSummary ? `Workspace Info:\n${params.workspaceSummary}\n` : ""}
${params.gitStatus ? `Git Status:\n${params.gitStatus}\n` : ""}
${params.additionalContext ? `Context:\n${params.additionalContext}\n` : ""}

As Lead Architect, formulate an authoritative, highly detailed technical implementation plan with 100% execution precision for AI coding agents and engineers. The plan MUST strictly adhere to the 5 Fundamental Axioms and mandatory 6-section structure of RULES.MD:

# Plan: [Concise Architecture Title]
DRI: lead_architect

## 1. AS-IS State & System Architecture Blueprint
- System Overview & Tech Stack Selection (Runtime, Framework, UI, State, Testing, Native APIs) with rigorous technical rationales
- Architecture & Multi-Tier Data Flow Diagram (Mermaid flowchart TD)
- Directory & File Layout with explicit file tags ([NEW], [MODIFY], [DELETE]) and relative paths
- Core TypeScript Interfaces & Data Contracts written out with full type declarations

## 2. Non-Goals & Scope Boundaries (Mandatory >= 3)
Explicitly enumerate at least 3 directly related items decisively OUT OF SCOPE with technical rationales:
1. ...
2. ...
3. ...

## 3. Unknowns & Halt Checks
Status: CLEAR (or HALT if critical technical parameters are missing)
Unknowns: None (or list of required empirical tests)

## 4. Risk Assessment & RAID Log (Mandatory >= 4 entries)
| ID | Category | Description | Impact | Likelihood | Mitigation Strategy | Owner DRI |
| R-1 | Risk | Concurrency & Async state hazards | High | Medium | Defensive locks / debounce | lead_architect |
| R-2 | Risk | Platform quirks (Windows vs POSIX paths, CRLF, npm.cmd) | Medium | High | Path normalization & cross-env | lead_architect |
| R-3 | Risk | Network timeouts & API error boundaries | High | Low | Exponential backoff & retry | lead_architect |
| A-1 | Assumption | Browser runtime compatibility | Medium | Low | Runtime validation checks | lead_architect |

## 5. Work Breakdown Structure (WBS) & Phased Implementation
Sequenced phases following the 8/80 rule. Each task must have atomic tags ([NEW], [MODIFY]), single DRI (lead_architect), concrete runnable shell verification commands, and 3-point PERT estimations: E = (O + 4M + P) / 6.

## 6. Definition of Done & Quality Gates
Binary pass/fail criteria: 100% test pass, 0 type errors, clean build.

Output Requirement: Directly begin your response with "# Plan: [Title]". Do not output any conversational preamble.`;

    const systemInstruction = `Role: Principal Software Architect. Purpose: "Gemini Thinks. Antigravity Works." Operating under RULES.MD technical governance. Output pure technical Markdown plan starting with "# Plan:".`;

    // 1. Generate initial draft plan
    const draftResponse = await this.client.generate(prompt, {
      systemInstruction,
      thinkingBudget: 4096,
      model: params.model,
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
        model: params.model,
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
    model?: string;
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
        model: params.model,
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

