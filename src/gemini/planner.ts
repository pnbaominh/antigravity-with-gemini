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

    const response = await this.client.generate(prompt, {
      systemInstruction,
      thinkingBudget: 4096,
    });

    const rawMarkdown = response.text;
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
}
