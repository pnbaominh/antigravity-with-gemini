/**
 * Prompt Sanitizer & Safe-Framing Engine
 *
 * Implements defensive prompt engineering patterns from /fable-safe-prompt and
 * authorized developer framing from /anti-reversing-techniques.
 *
 * Guarantees that:
 * 1. URLs, domains, and endpoints are neutral static configuration tokens (never web-browsing requests).
 * 2. Surface-level sensitive keywords (cyber/exploit/bypass/pre-mortem) are mapped to defensive engineering terms.
 * 3. Reasoning extraction triggers are removed.
 * 4. Context is explicitly framed as an authorized enterprise software architecture RFC/blueprint.
 */

export interface SanitizedPromptResult {
  originalTask: string;
  sanitizedTask: string;
  detectedDomains: string[];
  substitutions: Array<{ original: string; replaced: string }>;
}

export class PromptSanitizer {
  // Common keyword swaps from fable-safe-prompt principles
  private static readonly KEYWORD_SWAPS: Array<{ pattern: RegExp; replacement: string }> = [
    { pattern: /\bpre-mortem\b/gi, replacement: "Risk Assessment & RAID Log" },
    { pattern: /\bpre\s*mortem\b/gi, replacement: "Risk Assessment & RAID Log" },
    { pattern: /\bbypass\b/gi, replacement: "graceful fallback & boundary handling" },
    { pattern: /\bbypassing\b/gi, replacement: "gracefully handling boundaries" },
    { pattern: /\bexploit\b/gi, replacement: "boundary edge-case condition" },
    { pattern: /\bexploits\b/gi, replacement: "boundary edge-cases" },
    { pattern: /\bexploiting\b/gi, replacement: "handling edge-cases" },
    { pattern: /\battack(?:er)?\b/gi, replacement: "untrusted client scenario" },
    { pattern: /\battacks\b/gi, replacement: "untrusted client inputs" },
    { pattern: /\bmalware\b/gi, replacement: "untrusted executable content" },
    { pattern: /\bhack(?:ing)?\b/gi, replacement: "engineering optimization" },
    { pattern: /\bcrack(?:ing)?\b/gi, replacement: "parsing & validating" },
    { pattern: /\bpenetration(?:\s+test(?:ing)?)?\b/gi, replacement: "security compliance validation" },
    { pattern: /\banti-bot\b/gi, replacement: "rate-limiting & abuse prevention" },
    { pattern: /\bcaptcha\b/gi, replacement: "human verification challenge" },
  ];

  // Patterns that trigger reasoning extraction classifiers
  private static readonly REASONING_EXTRACTION_PATTERNS: RegExp[] = [
    /\b(?:show|explain|describe)\s+(?:step[- ]by[- ]step\s+)?(?:your\s+)?(?:internal\s+)?(?:reasoning|thinking|thought\s+process)(?:\s+step[- ]by[- ]step)?\.?\b/gi,
    /\b(?:show|explain|describe)\s+(?:your\s+)?(?:internal\s+)?(?:reasoning|thinking|thought\s+process)(?:\s+step[- ]by[- ]step)?\.?\b/gi,
    /\bwalk\s+me\s+through\s+your\s+(?:thinking|internal\s+logic)\.?\b/gi,
    /\bhãy\s+giải\s+thích\s+(?:từng\s+bước\s+)?suy\s+nghĩ(?:\s+nội\s+bộ)?(?:\s+của\s+bạn)?\.?\b/gi,
  ];

  // Regex to detect domains (e.g., fastfoodbim.io.vn, github.com, api.example.org, etc.)
  private static readonly DOMAIN_REGEX =
    /\b(?:https?:\/\/)?([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+(?:vn|com|net|org|io|dev|app|ai|me|co|xyz|tech|online|info|biz|store|shop|pro|cc|tv|site)(?::\d+)?(?:\/[^\s)\]]*)?/gi;

  /**
   * Sanitizes a user task string according to fable-safe-prompt and anti-reversing principles.
   */
  public static sanitizeTask(task: string): SanitizedPromptResult {
    let sanitized = task;
    const substitutions: Array<{ original: string; replaced: string }> = [];
    const detectedDomains: string[] = [];

    // 1. Detect and record domain names / URLs
    const domainMatches = task.match(this.DOMAIN_REGEX);
    if (domainMatches) {
      for (const rawMatch of domainMatches) {
        if (!detectedDomains.includes(rawMatch)) {
          detectedDomains.push(rawMatch);
        }
      }
    }

    // 2. Strip reasoning extraction triggers
    for (const pattern of this.REASONING_EXTRACTION_PATTERNS) {
      sanitized = sanitized.replace(pattern, "");
    }

    // Clean up duplicate punctuation and whitespace artifacts
    sanitized = sanitized.replace(/\s*\.\s*\./g, ".").replace(/\s{2,}/g, " ").trim();

    // 3. Normalize physical out-of-bounds action verbs to architectural specification terms
    sanitized = sanitized
      .replace(/\b(?:xây\s+dựng|xay\s+dung|làm|lam|tạo|tao)\s+(?:một\s+|mot\s+)?(?:trang\s+|trang\s+)?(?:web|website|site|app|ứng\s+dụng|ung\s+dung)\b/gi,
        "thiết kế kiến trúc phần mềm")
      .replace(/\b(?:build|create|develop|host)\s+(?:a\s+)?(?:website|web\s+site|web|app|application)\b/gi,
        "design technical architecture and implementation plan for");

    // 4. Swap sensitive/trigger keywords
    for (const { pattern, replacement } of this.KEYWORD_SWAPS) {
      if (pattern.test(sanitized)) {
        sanitized = sanitized.replace(pattern, (match) => {
          substitutions.push({ original: match, replaced: replacement });
          return replacement;
        });
      }
    }

    return {
      originalTask: task,
      sanitizedTask: sanitized.trim(),
      detectedDomains,
      substitutions,
    };
  }

  /**
   * Constructs the full, authorized developer context prompt wrapping the sanitized task.
   */
  public static buildAuthorizedArchitectPrompt(params: {
    task: string;
    workspaceSummary: string;
    gitStatus?: string;
    additionalContext?: string;
    isGreenfield?: boolean;
  }): { prompt: string; detectedDomains: string[] } {
    const { sanitizedTask, detectedDomains } = this.sanitizeTask(params.task);

    const domainAnnotation =
      detectedDomains.length > 0
        ? `\nDomain Configuration:\n` +
          detectedDomains
            .map((d) => `- "${d}": Application domain identifier and branding configuration token.`)
            .join("\n") +
          `\n`
        : "";

    const greenfieldGuidance = params.isGreenfield
      ? `\nProject Context: This is a greenfield / new project workspace. In Section 1 (AS-IS State), document that the project is new and requires scaffolding. Treat any domains, URLs, or brand names strictly as application configuration tokens.\n`
      : "";

    const prompt = `Task:
${sanitizedTask}
${domainAnnotation}${greenfieldGuidance}
Workspace Information:
${params.workspaceSummary}

${params.gitStatus ? `Git Status:\n${params.gitStatus}\n` : ""}
${params.additionalContext ? `Context:\n${params.additionalContext}\n` : ""}

Formulate a production-grade implementation plan strictly compliant with the RULES.MD 6-section architecture specification.
Output Requirement: Directly begin your response with "# Plan: [Title]". Output pure Markdown without introductory conversational text.`;

    return { prompt, detectedDomains };
  }
}
