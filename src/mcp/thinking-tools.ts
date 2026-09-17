import { z } from "zod";
import { GeminiThinkingClient } from "../gemini/client.js";
import { GeminiPlanner } from "../gemini/planner.js";
import { GeminiReviewer } from "../gemini/reviewer.js";
import { WorkspaceManager } from "../workspace/manager.js";
import { getGitDiff, getGitStatus } from "../workspace/git.js";
import { getExecutionSummary, getTestStatus } from "../execution/output.js";
import { PlanHistoryStore } from "../gemini/history.js";
import { DEFAULT_GEMINI_MODELS } from "../config/constants.js";

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
    "Request Gemini Deep Thinking to analyze a task and generate a structured, phased implementation plan with atomic steps and verification criteria.",
    {
      task: z.string().describe("The user task or feature description to plan for"),
      additionalContext: z
        .string()
        .optional()
        .describe("Additional architectural guidelines, technical constraints, or preferences"),
    },
    async ({ task, additionalContext }: { task: string; additionalContext?: string }) => {
      try {
        const info = workspaceManager.getInfo();
        const gitStatus = getGitStatus(workspaceRoot);
        const workspaceSummary = `Project: ${info.name}, Branch: ${info.branch || "unknown"}, Package Manager: ${info.packageManager}, Frameworks: ${info.frameworks.join(", ") || "none"}`;

        const plan = await planner.createPlan({
          task,
          workspaceSummary,
          gitStatus: gitStatus.summary,
          additionalContext,
        });

        historyStore.savePlan({
          task,
          source: "mcp",
          model: DEFAULT_GEMINI_MODELS.THINKING,
          title: plan.title,
          summary: plan.summary,
          phases: plan.phases,
          rawMarkdown: plan.rawMarkdown,
          additionalContext,
        });

        return {
          content: [
            {
              type: "text",
              text: plan.rawMarkdown,
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
}
