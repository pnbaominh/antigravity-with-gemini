import type { GeminiGenerationClient } from "./client-interface.js";
import { PromptSanitizer } from "./prompt-sanitizer.js";

export interface AgencyQuestionOption {
  label: string;
  description?: string;
  isRecommended?: boolean;
}

export interface AgencyQuestion {
  id: string;
  pillar: "Mission" | "Architecture" | "NonGoals" | "RealityCheck" | "DefinitionOfDone";
  pillarTitle: string;
  question: string;
  rationale: string;
  options?: AgencyQuestionOption[];
  allowCustomInput?: boolean;
}

export interface AgencyDiscoveryResult {
  persona: string;
  task: string;
  questions: AgencyQuestion[];
  rawMarkdown: string;
}

/**
 * Agency Discovery Engine based on msitarzewski/agency-agents methodology.
 *
 * Implements authoritative, role-specialized discovery protocols:
 * 1. Persona-driven discovery (Principal Architect, Discovery Coach, Testing Reality Checker).
 * 2. 5 Strategic Discovery Pillars (Mission, Architecture, Non-Goals, Reality Check, Definition of Done).
 * 3. Structured, actionable multiple-choice options with explicit (Recommended) guidance.
 */
export class AgencyDiscoveryEngine {
  private client: GeminiGenerationClient;

  constructor(client: GeminiGenerationClient) {
    this.client = client;
  }

  /**
   * Generates a structured discovery questionnaire for a task using the agency-agents framework.
   */
  public async discover(params: {
    task: string;
    workspaceSummary?: string;
    persona?: "architect" | "reality-checker" | "product-coach" | "security-auditor";
    language?: "vi" | "en";
    model?: string;
  }): Promise<AgencyDiscoveryResult> {
    const isVN =
      params.language === "vi" ||
      (!params.language &&
        /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(params.task));

    const persona = params.persona || "architect";
    const personaTitle =
      persona === "reality-checker"
        ? isVN
          ? "Testing Reality Checker & Gatekeeper (msitarzewski/agency-agents)"
          : "Testing Reality Checker & Gatekeeper (msitarzewski/agency-agents)"
        : persona === "security-auditor"
        ? isVN
          ? "DevSecOps & Security Specialist (msitarzewski/agency-agents)"
          : "DevSecOps & Security Specialist (msitarzewski/agency-agents)"
        : persona === "product-coach"
        ? isVN
          ? "Discovery & Scoping Coach (msitarzewski/agency-agents)"
          : "Discovery & Scoping Coach (msitarzewski/agency-agents)"
        : isVN
        ? "Principal Systems Architect & Lead Engineer (msitarzewski/agency-agents)"
        : "Principal Systems Architect & Lead Engineer (msitarzewski/agency-agents)";

    const sanitized = PromptSanitizer.sanitizeTask(params.task);

    const systemInstruction = `You are the ${personaTitle}.
Your methodology strictly follows the msitarzewski/agency-agents agency standard:
- You are a specialized expert with personality, rigorous processes, and deliverable-focused questions.
- Never ask vague, passive, or open-ended fluff.
- You treat requirements as a binding technical contract.
- Your goal is to eliminate ambiguities, avoid scope creep, expose hidden edge cases, and define verifiable acceptance gates BEFORE writing code.`;

    const prompt = isVN
      ? `Vai trò: ${personaTitle}
Phương pháp luận: msitarzewski/agency-agents Discovery Protocol

NHIỆM VỤ CẦN KHẢO SÁT & LÀM RÕ YÊU CẦU:
"${sanitized.sanitizedTask}"
${params.workspaceSummary ? `\nNgữ cảnh Workspace:\n${params.workspaceSummary}\n` : ""}

Hãy xây dựng bộ câu hỏi khảo sát kỹ thuật chuyên sâu theo đúng 5 Trụ Cột Discovery của Agency-Agents:

### 1. 🎯 Mục Tiêu Cốt Lõi & Giá Trị Kỹ Thuật (Mission & Value Metric)
- Làm rõ bài toán gốc rễ cần giải quyết thay vì chỉ xử lý triệu chứng bề mặt.
- Chỉ số đo lường thành công định lượng (KPI, throughput, latency, UX).

### 2. ⚙️ Ràng Buộc Kiến Trúc & Tech Stack (Architecture Invariants)
- Ràng buộc phiên bản runtime/ngôn ngữ, thư viện, cơ sở dữ liệu, state store.
- Cơ chế quản lý cấu hình và boundary giữa các module.

### 3. 🚫 Non-Goals & Giới Hạn Phạm Vi (Strict Boundaries)
- Xác định dứt khoát các tính năng hoặc module nào KHÔNG được chạm vào / không làm trong chu kỳ này để triệt tiêu scope creep.

### 4. ⚠️ Bẫy Kỹ Thuật & Pre-Mortem Reality Check (Failure Modes)
- Dự báo trước các bẫy chí mạng: race conditions, concurrency, bất tương thích OS (Windows paths, CRLF vs LF), timeout, API rate limit.
- Kế hoạch xử lý khi hệ sinh thái phụ thuộc bị lỗi.

### 5. ✅ Tiêu Chuẩn Nghiệm Thu & Lệnh Kiểm Thử (Definition of Done)
- Lệnh shell kiểm thử nhị phân cụ thể (npm test, pytest, cargo test) để chứng minh tính đúng đắn.
- Tiêu chí nghiệm thu nhị phân (Pass/Fail).

ĐỊNH DẠNG ĐẦU RA BẮT BUỘC:
Mỗi trụ cột có 1-2 câu hỏi sắc bén, kèm ít nhất 2-3 phương án lựa chọn (Options) với phương án tối ưu được gắn nhãn "(Recommended)" đứng đầu tiên, cùng phần phân tích ngắn gọn lý do tại sao câu hỏi này tối quan trọng.`
      : `Role: ${personaTitle}
Methodology: msitarzewski/agency-agents Discovery Protocol

TASK UNDER TECHNICAL SCOPING & DISCOVERY:
"${sanitized.sanitizedTask}"
${params.workspaceSummary ? `\nWorkspace Context:\n${params.workspaceSummary}\n` : ""}

Formulate a structured, authoritative discovery questionnaire adhering strictly to the 5 Strategic Pillars of the Agency-Agents methodology:

### 1. 🎯 Mission & Value Metric (The Core 'Why')
- Clarify the underlying root problem rather than superficial symptoms.
- Quantitative success metrics (KPI, latency, UX).

### 2. ⚙️ Architectural Constraints & Tech Stack (The 'How')
- Target runtime versions, database/storage contracts, state management boundaries.

### 3. 🚫 Strict Non-Goals & Scope Boundaries (The 'What NOT to do')
- Explicitly identify features, files, or subsystems that are OUT OF SCOPE to prevent scope creep.

### 4. ⚠️ Pre-Mortem & Reality Check (Failure Modes & Traps)
- Anticipate concurrency hazards, platform quirks (e.g., Windows paths vs POSIX), timeouts, rate limits.
- Failure containment strategy.

### 5. ✅ Definition of Done & Verification Commands (Deliverables)
- Exact runnable shell verification commands (e.g. npm test, pytest) proving correctness.
- Binary acceptance gates.

OUTPUT FORMAT:
For each pillar, present 1-2 high-signal questions with structured selectable options. Prefix the recommended choice with "(Recommended)". Provide a concise technical rationale for why each question is essential.`;

    const response = await this.client.generate(prompt, {
      systemInstruction,
      thinkingBudget: 8192,
      model: params.model || "4 Argon",
    });

    const rawMarkdown = response.text || "";
    const questions = this.parseQuestions(rawMarkdown, isVN);

    return {
      persona: personaTitle,
      task: params.task,
      questions,
      rawMarkdown,
    };
  }

  /**
   * Parses markdown discovery output into structured question records.
   */
  private parseQuestions(markdown: string, isVN: boolean): AgencyQuestion[] {
    const questions: AgencyQuestion[] = [];
    const pillarRegex = /###\s*([0-9]+\.\s*[^#\n]+)([\s\S]*?)(?=(?:###\s*[0-9]+\.|$))/g;
    let match;

    while ((match = pillarRegex.exec(markdown)) !== null) {
      const header = match[1].trim();
      const body = match[2].trim();

      let pillar: AgencyQuestion["pillar"] = "Mission";
      if (/1|mục tiêu|mission|value/i.test(header)) pillar = "Mission";
      else if (/2|kiến trúc|architecture|stack/i.test(header)) pillar = "Architecture";
      else if (/3|non-goal|phạm vi|boundary/i.test(header)) pillar = "NonGoals";
      else if (/4|bẫy|pre-mortem|reality|risk/i.test(header)) pillar = "RealityCheck";
      else if (/5|nghiệm thu|verification|definition/i.test(header)) pillar = "DefinitionOfDone";

      // Extract questions within pillar body
      const questionBlocks = body.split(/\n(?=[-*]\s*\*\*|\d+\.\s*\*?\*?)/);
      for (const block of questionBlocks) {
        const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
        if (lines.length === 0) continue;

        const titleLine = lines[0].replace(/^[-*\d.]+\s*/, "").replace(/^\*\*|\*\*$/g, "");
        const optionLines = lines.filter((l) =>
          /^[-*]\s*(?:\[[ xX*]?\]|[A-Da-d]\)|\([A-Da-d]\)|[A-Da-d]\.)/i.test(l)
        );

        const options: AgencyQuestionOption[] = optionLines.map((opt) => {
          const clean = opt.replace(/^[-*]\s*(?:\[[ xX*]?\])?\s*|^[A-Da-d][).]\s*/i, "").trim();
          const isRec = clean.toLowerCase().includes("(recommended)") || clean.toLowerCase().includes("(khuyến nghị)");
          return {
            label: clean.replace(/\(Recommended\)/i, "").replace(/\(Khuyến nghị\)/i, "").trim(),
            isRecommended: isRec,
          };
        });

        questions.push({
          id: `Q-${questions.length + 1}`,
          pillar,
          pillarTitle: header,
          question: titleLine,
          rationale: lines.slice(1).find((l) => !l.startsWith("-") && !l.startsWith("*")) || (isVN ? "Làm rõ yêu cầu kỹ thuật theo chuẩn Agency-Agents" : "Clarifies technical requirement per Agency-Agents standard"),
          options: options.length > 0 ? options : undefined,
          allowCustomInput: true,
        });
      }
    }

    return questions;
  }
}
