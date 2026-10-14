/**
 * @file src/types.ts
 * @description Core Data Transfer Objects (DTOs), Domain Entities, and Runtime Zod Schemas
 * Compliant with TPEG-v3 Enterprise (RULES.MD Section 2.2 - Zero `any` Policy)
 */

import { z } from "zod";
import type { SingletonLockCleanupResult } from "./utils/platform.js";

export type { SingletonLockCleanupResult };

// ============================================================================
// 1. MODEL REGISTRY 4 ARGON & ROUTING CONTRACTS
// ============================================================================

export const ModelIdSchema = z.string().min(1);

export type ModelId = z.infer<typeof ModelIdSchema>;

export const TaskCategorySchema = z.enum(["plan", "review", "ask", "think"]);

export type TaskCategory = z.infer<typeof TaskCategorySchema>;

export const ModelCapabilitySchema = z.object({
  id: ModelIdSchema,
  displayName: z.string().min(1),
  generation: z.number().min(2).max(5),
  thinkingBudget: z.number().int().min(0).max(32768),
  maxInputTokens: z.number().int().positive().default(1048576),
  maxOutputTokens: z.number().int().positive().default(65536),
  supportsWebUiSelection: z.boolean().default(true),
  webUiSelectorLabels: z.array(z.string().min(1)).nonempty(),
  defaultTimeoutMs: z.number().int().min(5000).max(300000).default(180000),
  fallbackModelId: z.string().nullable().default(null),
});

export type ModelCapability = z.infer<typeof ModelCapabilitySchema>;

export interface ModelRoutingResolution {
  readonly primaryModel: ModelCapability;
  readonly fallbackChain: readonly ModelCapability[];
  readonly taskCategory: TaskCategory;
  readonly enforcedThinkingBudget: number;
}

// ============================================================================
// 2. PLAYWRIGHT WEB ENGINE & RESILIENCE CONTRACTS
// ============================================================================

export const BrowserChannelSchema = z.enum([
  "chrome",
  "msedge",
  "brave",
  "chromium",
]);

export type BrowserChannel = z.infer<typeof BrowserChannelSchema>;

export const WebEngineConfigSchema = z.object({
  userDataDir: z.string().min(1),
  headless: z.boolean().default(false),
  preferredChannel: BrowserChannelSchema.optional(),
  executablePath: z.string().optional(),
  navigationTimeoutMs: z.number().int().min(5000).max(60000).default(30000),
  responseTimeoutMs: z.number().int().min(10000).max(300000).default(180000),
  stabilityWindowMs: z.number().int().min(500).max(10000).default(2500),
  maxRetries: z.number().int().min(0).max(5).default(3),
  baseBackoffMs: z.number().int().min(200).max(10000).default(1000),
  circuitBreakerThreshold: z.number().int().min(2).max(10).default(3),
  circuitBreakerResetMs: z.number().int().min(5000).max(300000).default(60000),
});

export type WebEngineConfig = z.infer<typeof WebEngineConfigSchema>;

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerSnapshot {
  readonly state: CircuitState;
  readonly consecutiveFailures: number;
  readonly lastFailureTimestampMs: number | null;
  readonly nextAttemptAllowedAtMs: number | null;
}

// ============================================================================
// 3. AGENCY DISCOVERY & RECONNAISSANCE DOSSIER CONTRACTS
// ============================================================================

export interface ReconnaissanceDossier {
  readonly projectName: string;
  readonly projectVersion: string;
  readonly moduleType: "module" | "commonjs";
  readonly workspacePath: string;
  readonly normalizedPosixPath: string;
  readonly coreDependencies: readonly string[];
  readonly devDependencies: readonly string[];
  readonly npmScripts: readonly string[];
  readonly configFilesDetected: readonly string[];
  readonly topLevelDirectories: readonly string[];
  readonly gitBranch: string;
  readonly gitWorkingTreeClean: boolean;
  readonly rulesMdContent: string | null;
}

export interface AgencyDiscoveryQuestion {
  readonly id: string;
  readonly dimension: "architecture" | "scope" | "security" | "data-contract" | "testing";
  readonly question: string;
  readonly rationale: string;
  readonly defaultAssumptionIfUnanswered: string;
}

export interface AgencyDiscoveryReport {
  readonly dossier: ReconnaissanceDossier;
  readonly questions: readonly AgencyDiscoveryQuestion[];
  readonly formattedPromptBlock: string;
}

// ============================================================================
// 4. MCP TOOL INPUT, IDEMPOTENCY & WORKSPACE CONTRACTS
// ============================================================================

export interface IdempotencyRecord<T> {
  readonly key: string;
  readonly status: "IN_PROGRESS" | "COMPLETED" | "FAILED";
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly result?: T;
  readonly errorMessage?: string;
}

export const GeminiPlanInputSchema = z.object({
  task: z.string().min(5, "Task description must contain at least 5 characters"),
  workspacePath: z.string().min(1).optional(),
  modelId: ModelIdSchema.optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export type GeminiPlanInput = z.infer<typeof GeminiPlanInputSchema>;

export const GeminiReviewInputSchema = z.object({
  taskDescription: z.string().min(3),
  workspacePath: z.string().min(1).optional(),
  baseRef: z.string().min(1).optional(),
});

export type GeminiReviewInput = z.infer<typeof GeminiReviewInputSchema>;

export const GeminiThinkInputSchema = z.object({
  query: z.string().min(5),
  workspacePath: z.string().min(1).optional(),
  contextFiles: z.array(z.string()).max(15).optional(),
});

export type GeminiThinkInput = z.infer<typeof GeminiThinkInputSchema>;

export const ReadFileToolInputSchema = z.object({
  filePath: z.string().min(1),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
  workspacePath: z.string().min(1).optional(),
});

export type ReadFileToolInput = z.infer<typeof ReadFileToolInputSchema>;

export const SearchCodeToolInputSchema = z.object({
  pattern: z.string().min(1).max(200),
  subDir: z.string().optional(),
  maxResults: z.number().int().min(1).max(200).default(50),
  workspacePath: z.string().min(1).optional(),
});

export type SearchCodeToolInput = z.infer<typeof SearchCodeToolInputSchema>;
