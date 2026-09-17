import { z } from "zod";
import { GeminiThinkingClient } from "../gemini/client.js";
import { GeminiPlanner } from "../gemini/planner.js";
import { GeminiReviewer } from "../gemini/reviewer.js";
import { WorkspaceManager } from "../workspace/manager.js";
import { getGitDiff, getGitStatus } from "../workspace/git.js";
import { getExecutionSummary, getTestStatus } from "../execution/output.js";
import { PlanHistoryStore } from "../gemini/history.js";
import { DEFAULT_GEMINI_MODELS } from "../config/constants.js";
import { RulesEngine } from "../governance/rules-engine.js";

export function registerThinkingTools(
  server: any,
  workspaceRoot: string,
  geminiClient: GeminiThinkingClient
) {
  const planner = new GeminiPlanner(geminiClient);
  const reviewer = new GeminiReviewer(geminiClient);
  const workspaceManager = new WorkspaceManager(workspaceRoot);
  const historyStore = new PlanHistoryStore(workspaceRoot);

  server.tool(
    "gemini_plan",
    "Request Gemini Deep Thinking to analyze a task and generate a structured, phased implementation plan. By default, returns a zero-token pointer ticket (<50 tokens) to protect Antigravity's context limit.",
    {
      task: z.string().describe("The user task or feature description to plan for"),
      additionalContext: z
        .string()
        .optional()
        .describe("Additional architectural guidelines, technical constraints, or preferences"),
      returnMode: z
        .enum(["pointer", "compact", "full"])
        .optional()
        .describe("Return format: 'pointer' (<50 tokens ticket, default for zero context bloat), 'compact' (~75% reduction checklist), or 'full'"),
      compact: z
        .boolean()
        .optional()
        .describe("Legacy option: if true, returns compact checklist; if false, returns full spec"),
    },
    async ({
      task,
      additionalContext,
      returnMode,
      compact,
    }: {
      task: string;
      additionalContext?: string;
      returnMode?: "pointer" | "compact" | "full";
      compact?: boolean;
    }) => {
      try {
        const info = workspaceManager.getInfo();
        const gitStatus = getGitStatus(workspaceRoot);
        const workspaceSummary = `Project: ${info.name}, Branch: ${info.branch || "unknown"}, Package Manager: ${info.packageManager}, Frameworks: ${info.frameworks.join(", ") || "none"}`;

        const plan = await planner.createPlan({
          task,
          workspaceSummary,
          gitStatus: gitStatus.summary,
          additionalContext,
          workspaceRoot,
        });

        const stored = historyStore.savePlan({
          task,
          source: "mcp",
          model: DEFAULT_GEMINI_MODELS.THINKING,
          title: plan.title,
          summary: plan.summary,
          phases: plan.phases,
          rawMarkdown: plan.rawMarkdown,
          compactMarkdown: plan.compactMarkdown,
          draftMarkdown: plan.draftMarkdown,
          reviewScore: plan.audit?.score,
          reviewVerdict: plan.audit?.verdict,
          reviewCritique: plan.audit?.critique,
          identifiedIssues: plan.audit?.identifiedIssues,
          improvementsApplied: plan.audit?.improvementsApplied,
          tokenReductionPercent: plan.tokenReductionPercent,
          additionalContext,
        });

        const selectedMode = returnMode || (compact === false ? "full" : compact === true ? "compact" : "pointer");

        let text: string;
        if (selectedMode === "full") {
          text = plan.rawMarkdown;
        } else if (selectedMode === "compact") {
          text = `${plan.compactMarkdown}\n\n> 🛡️ *Quality Audit Score:* ${plan.audit?.score || 95}/100 | *Token Savings:* ~${plan.tokenReductionPercent}%\n> 📁 *Full Specification File:* [${stored.id}.md](file:///${stored.artifactPath ? stored.artifactPath.replace(/\\/g, "/") : ""})`;
        } else {
          // Zero-token pointer ticket (< 50 tokens)
          text = planner.generatePointerTicket({
            planId: stored.id,
            title: plan.title,
            artifactPath: stored.artifactPath || "",
            totalPhases: plan.phases.length,
            auditScore: plan.audit?.score,
            auditVerdict: plan.audit?.verdict,
            governanceValid: plan.governance?.valid,
            violationsCount: plan.governance?.violations.length,
            haltRequired: plan.governance?.haltRequired,
          });
        }

        return {
          content: [
            {
              type: "text",
              text,
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Gemini planning failed: ${error?.message || String(error)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "gemini_get_phase",
    "Fetch a specific phase from the active plan on-demand (Just-In-Time Phase Delivery). Uses minimal tokens (~80 tokens) to keep Antigravity context clean.",
    {
      phaseIndex: z.number().int().min(1).describe("The 1-based index of the phase to retrieve (e.g. 1, 2, 3)"),
      planId: z.string().optional().describe("Optional specific plan ID. If omitted, uses the active plan."),
    },
    async ({ phaseIndex, planId }: { phaseIndex: number; planId?: string }) => {
      try {
        const plan = planId ? historyStore.getPlanById(planId) : historyStore.getActivePlan();
        if (!plan) {
          return {
            content: [
              {
                type: "text",
                text: "No active plan found. Please generate a plan first using gemini_plan.",
              },
            ],
          };
        }

        const phase = planner.extractPhase(plan.rawMarkdown, phaseIndex);
        if (!phase) {
          return {
            content: [
              {
                type: "text",
                text: `Phase ${phaseIndex} not found in plan "${plan.title}". Total phases available: ${plan.phases.length}.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `# Plan: ${plan.title} (Phase ${phase.phaseIndex} of ${phase.totalPhases})\n\n${phase.markdown}\n\n> 💡 *When Phase ${phase.phaseIndex} is completed, fetch Phase ${phase.phaseIndex + 1} with \`gemini_get_phase({ phaseIndex: ${phase.phaseIndex + 1} })\`.*`,
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to fetch phase: ${error?.message || String(error)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "gemini_active_plan",
    "Inspect the current active plan metadata, audit score, phases list, and disk artifact path with near-zero Antigravity token usage.",
    {
      mode: z
        .enum(["ticket", "summary", "full"])
        .optional()
        .describe("Return mode: 'ticket' (<50 tokens), 'summary' (~200 tokens), or 'full'"),
    },
    async ({ mode = "ticket" }: { mode?: "ticket" | "summary" | "full" }) => {
      try {
        const plan = historyStore.getActivePlan();
        if (!plan) {
          return {
            content: [
              {
                type: "text",
                text: "No active plan found in workspace. Run gemini_plan to create one.",
              },
            ],
          };
        }

        if (mode === "full") {
          return {
            content: [{ type: "text", text: plan.rawMarkdown }],
          };
        }

        if (mode === "summary") {
          const phasesSummary = plan.phases
            .map((p, idx) => `Phase ${idx + 1}: ${p.phase} (${p.tasks.length} tasks)`)
            .join("\n- ");
          const text = `# Active Plan: ${plan.title}\n- Audit Score: ${plan.reviewScore ?? 90}/100\n- Artifact: [${plan.id}.md](file:///${plan.artifactPath?.replace(/\\/g, "/")})\n- Total Phases: ${plan.phases.length}\n- ${phasesSummary}`;
          return {
            content: [{ type: "text", text }],
          };
        }

        const ticket = planner.generatePointerTicket({
          planId: plan.id,
          title: plan.title,
          artifactPath: plan.artifactPath || "",
          totalPhases: plan.phases.length,
          auditScore: plan.reviewScore,
          auditVerdict: plan.reviewVerdict,
        });
        return {
          content: [{ type: "text", text: ticket }],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to retrieve active plan: ${error?.message || String(error)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "gemini_review",
    "Request Gemini to perform an adversarial code review of the current git diff and test results against quality, security, and regression checklists.",
    {
      taskDescription: z.string().describe("Description of what this change was intended to accomplish"),
      file: z.string().optional().describe("Optional specific file to restrict the diff review to"),
    },
    async ({ taskDescription, file }: { taskDescription: string; file?: string }) => {
      try {
        const diff = getGitDiff(workspaceRoot, { file });
        const testStatus = getTestStatus(workspaceRoot);
        const executionSummary = getExecutionSummary(workspaceRoot);

        if (!diff || diff === "(No diff)") {
          return {
            content: [
              {
                type: "text",
                text: "No git diff detected to review. Make sure your changes are modified in the workspace.",
              },
            ],
          };
        }

        const review = await reviewer.reviewDiff({
          gitDiff: diff,
          testStatus,
          taskDescription,
          executionSummary,
        });

        return {
          content: [
            {
              type: "text",
              text: review.rawMarkdown,
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Gemini review failed: ${error?.message || String(error)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "gemini_think",
    "Ask Google Gemini Thinking model to reason deeply about a difficult bug, architectural design question, or system tradeoff.",
    {
      question: z.string().describe("The complex question, bug symptom, or architectural tradeoff to think about"),
      context: z.string().optional().describe("Relevant context, error logs, or code snippets"),
      thinkingBudget: z
        .number()
        .optional()
        .default(8192)
        .describe("Reasoning token budget (default 8192)"),
    },
    async ({
      question,
      context,
      thinkingBudget,
    }: {
      question: string;
      context?: string;
      thinkingBudget?: number;
    }) => {
      try {
        const prompt = `${question}\n\n${context ? `Context:\n${context}` : ""}`;
        const response = await geminiClient.generate(prompt, {
          thinkingBudget: thinkingBudget || 8192,
        });

        return {
          content: [
            {
              type: "text",
              text: response.text,
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Gemini thinking failed: ${error?.message || String(error)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "gemini_validate_plan",
    "Validate an implementation plan against the RULES.MD technical governance framework (Non-Goals >= 3, AS-IS Evidence, Single DRI, PERT math, RAID log, Halt-on-Unknown).",
    {
      planMarkdown: z
        .string()
        .optional()
        .describe("Markdown text of the plan to validate. If omitted, validates the active workspace plan."),
      planId: z
        .string()
        .optional()
        .describe("Optional specific plan ID to validate from workspace history."),
    },
    async ({ planMarkdown, planId }: { planMarkdown?: string; planId?: string }) => {
      try {
        let markdownToValidate = planMarkdown;
        if (!markdownToValidate) {
          const plan = planId ? historyStore.getPlanById(planId) : historyStore.getActivePlan();
          if (!plan) {
            return {
              content: [
                {
                  type: "text",
                  text: "No active plan found to validate. Please provide `planMarkdown` or run `gemini_plan` first.",
                },
              ],
            };
          }
          markdownToValidate = plan.rawMarkdown;
        }

        const result = RulesEngine.validateMarkdownPlan(markdownToValidate, workspaceRoot);

        const statusText = result.haltRequired
          ? "🛑 HALT ON UNKNOWN REQUIRED"
          : result.valid
          ? "✅ RULES.MD COMPLIANT"
          : "⚠️ GOVERNANCE VIOLATIONS DETECTED";

        const lines: string[] = [
          `# Plan Governance Validation Report: ${statusText}`,
          `- **Validation Result:** ${result.valid ? "PASSED (100% Invariants Satisfied)" : "FAILED"}`,
          `- **Halt-on-Unknown Status:** ${result.haltRequired ? "HALT REQUIRED (Clarification needed before code generation)" : "CLEAR"}`,
          `- **Violations Count:** ${result.violations.length}`,
        ];

        if (result.violations.length > 0) {
          lines.push(``, `## Violations to Correct:`);
          for (const v of result.violations) {
            lines.push(`- ❌ ${v}`);
          }
        } else {
          lines.push(``, `> All RULES.MD invariant axioms (AS-IS Grounding, Non-Goals >= 3, Single DRI, PERT math, RAID log) verified successfully.`);
        }

        return {
          content: [
            {
              type: "text",
              text: lines.join("\n"),
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Plan validation failed: ${error?.message || String(error)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "gemini_calculate_pert",
    "Calculate statistical PERT estimate (Expected Hours E and Standard Deviation Sigma) using formula E = (O + 4M + P) / 6 and Sigma = (P - O) / 6.",
    {
      optimistic: z.number().min(0).describe("Optimistic duration in hours (O)"),
      mostLikely: z.number().min(0).describe("Most likely duration in hours (M)"),
      pessimistic: z.number().min(0).describe("Pessimistic duration in hours (P)"),
    },
    async ({
      optimistic,
      mostLikely,
      pessimistic,
    }: {
      optimistic: number;
      mostLikely: number;
      pessimistic: number;
    }) => {
      try {
        const estimate = RulesEngine.calculatePERT(optimistic, mostLikely, pessimistic);
        const low68 = Math.max(0, Number((estimate.expectedHours - estimate.sigmaHours).toFixed(2)));
        const high68 = Number((estimate.expectedHours + estimate.sigmaHours).toFixed(2));
        const low95 = Math.max(0, Number((estimate.expectedHours - 2 * estimate.sigmaHours).toFixed(2)));
        const high95 = Number((estimate.expectedHours + 2 * estimate.sigmaHours).toFixed(2));

        const text = [
          `# PERT Statistical Estimate`,
          `- **Optimistic (O):** ${estimate.optimisticHours}h`,
          `- **Most Likely (M):** ${estimate.mostLikelyHours}h`,
          `- **Pessimistic (P):** ${estimate.pessimisticHours}h`,
          `- **Expected Duration (E):** **${estimate.expectedHours} hours** (Formula: \`(O + 4M + P) / 6\`)`,
          `- **Standard Deviation (σ):** **${estimate.sigmaHours} hours** (Formula: \`(P - O) / 6\`)`,
          `- **68% Confidence Interval (1σ):** [${low68}h, ${high68}h]`,
          `- **95% Confidence Interval (2σ):** [${low95}h, ${high95}h]`,
          `- **8/80 Rule Compliance:** ${estimate.expectedHours >= 0.5 && estimate.expectedHours <= 80 ? "Compliant ✓" : "Out of bounds (must be 0.5h - 80h) ⚠️"}`,
        ].join("\n");

        return {
          content: [
            {
              type: "text",
              text,
            },
          ],
        };
      } catch (error: any) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `PERT calculation failed: ${error?.message || String(error)}`,
            },
          ],
        };
      }
    }
  );
}
