import type { GeminiGenerationClient } from "./client-interface.js";

export interface ReviewFinding {
  severity: "CRITICAL" | "WARNING" | "SUGGESTION";
  file?: string;
  line?: number;
  issue: string;
  recommendation: string;
}

export interface ReviewResult {
  verdict: "APPROVED" | "CHANGES_REQUESTED";
  summary: string;
  findings: ReviewFinding[];
  rawMarkdown: string;
}

export class GeminiReviewer {
  private client: GeminiGenerationClient;

  constructor(client: GeminiGenerationClient) {
    this.client = client;
  }

  async reviewDiff(params: {
    gitDiff: string;
    testStatus?: string;
    taskDescription: string;
    executionSummary?: string;
  }): Promise<ReviewResult> {
    const systemInstruction = `You are the master adversarial reviewer for Antigravity coding tasks.
Your job is to rigorously review the git diff and test output.
Never accept claims that "tests passed" without verifying logic.
Check against:
1. Functionality: Does this fully satisfy the user's task? Are edge cases handled?
2. Security: No injection, no hardcoded secrets, input sanitization, safe error handling.
3. Quality & Maintainability: Clean naming, single responsibility, no duplicate code, proper error boundaries.
4. Regressions: Could this change break existing callers or dependencies?

Output your review in structured Markdown:
# Code Review Verdict: [APPROVED | CHANGES_REQUESTED]

## Review Summary
[Concise summary of strengths and concerns]

## Findings
### [CRITICAL | WARNING | SUGGESTION]: [Brief title]
- **File:** [filename or path]
- **Issue:** [Clear description of what is wrong]
- **Recommendation:** [Exact fix or code sample]`;

    const prompt = `Task Description:
${params.taskDescription}

Execution Summary:
${params.executionSummary || "(None provided)"}

Test Status:
${params.testStatus || "(None provided)"}

Git Diff:
\`\`\`diff
${params.gitDiff}
\`\`\`

Perform an adversarial, thorough code review. Identify any critical flaws, missed edge cases, or security hazards.`;

    const response = await this.client.generate(prompt, {
      systemInstruction,
      thinkingBudget: 8192,
    });

    const rawMarkdown = response.text;
    const isApproved = /# Code Review Verdict:\s*APPROVED/i.test(rawMarkdown);

    return {
      verdict: isApproved ? "APPROVED" : "CHANGES_REQUESTED",
      summary: rawMarkdown.slice(0, 300) + "...",
      findings: this.parseFindings(rawMarkdown),
      rawMarkdown,
    };
  }

  private parseFindings(markdown: string): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    const findingRegex = /###\s*(CRITICAL|WARNING|SUGGESTION):\s*([^\n]+)([\s\S]*?)(?=(###\s*(CRITICAL|WARNING|SUGGESTION)|$))/gi;
    let match;

    while ((match = findingRegex.exec(markdown)) !== null) {
      const severity = match[1].toUpperCase() as ReviewFinding["severity"];
      const title = match[2].trim();
      const content = match[3];

      const fileMatch = content.match(/\*\*File:\*\*\s*([^\n]+)/i);
      const issueMatch = content.match(/\*\*Issue:\*\*\s*([^\n]+)/i);
      const recMatch = content.match(/\*\*Recommendation:\*\*\s*([\s\S]*?)$/i);

      findings.push({
        severity,
        file: fileMatch ? fileMatch[1].trim() : undefined,
        issue: issueMatch ? issueMatch[1].trim() : title,
        recommendation: recMatch ? recMatch[1].trim() : "Review and resolve this concern.",
      });
    }

    return findings;
  }
}
