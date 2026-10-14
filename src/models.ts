/**
 * @file src/models.ts
 * @description Gemini 4 Argon & Modern Models Registry & Task Routing Engine
 */

import {
  type ModelCapability,
  type ModelRoutingResolution,
  type TaskCategory,
} from "./types.js";
import { DynamicModelRegistry } from "./gemini/model-registry.js";

export { DynamicModelRegistry };

export const REGISTERED_MODEL_CAPABILITIES: Record<string, ModelCapability> = {
  "gemini-4-argon": {
    id: "gemini-4-argon",
    displayName: "Gemini 4 Argon",
    generation: 4.0,
    thinkingBudget: 8192,
    maxInputTokens: 2097152,
    maxOutputTokens: 65536,
    supportsWebUiSelection: true,
    webUiSelectorLabels: ["4 Argon", "Argon", "4.0", "4"],
    defaultTimeoutMs: 180000,
    fallbackModelId: "gemini-3.8-flash",
  },
  "gemini-3.8-flash": {
    id: "gemini-3.8-flash",
    displayName: "Gemini 3.8 Flash",
    generation: 3.8,
    thinkingBudget: 8192,
    maxInputTokens: 1048576,
    maxOutputTokens: 65536,
    supportsWebUiSelection: true,
    webUiSelectorLabels: ["3.8 Flash", "3.8", "Flash Mở rộng", "Flash"],
    defaultTimeoutMs: 120000,
    fallbackModelId: "gemini-3.1-pro",
  },
  "gemini-3.1-pro": {
    id: "gemini-3.1-pro",
    displayName: "Gemini 3.1 Pro",
    generation: 3.1,
    thinkingBudget: 4096,
    maxInputTokens: 1048576,
    maxOutputTokens: 65536,
    supportsWebUiSelection: true,
    webUiSelectorLabels: ["3.1 Pro", "3.1", "Pro Mở rộng", "Pro"],
    defaultTimeoutMs: 120000,
    fallbackModelId: "gemini-3.5-flash-lite",
  },
  "gemini-3.5-flash-lite": {
    id: "gemini-3.5-flash-lite",
    displayName: "Gemini 3.5 Flash-Lite",
    generation: 3.5,
    thinkingBudget: 0,
    maxInputTokens: 524288,
    maxOutputTokens: 32768,
    supportsWebUiSelection: true,
    webUiSelectorLabels: ["Flash-Lite", "3.5"],
    defaultTimeoutMs: 60000,
    fallbackModelId: null,
  },
};

/**
 * Normalizes user/CLI model input string into a standard model capability key.
 */
export function normalizeModelKey(input?: string): string {
  if (!input) return "gemini-4-argon";
  const lower = input.toLowerCase();
  if (lower.includes("argon") || lower.includes("4")) return "gemini-4-argon";
  if (lower.includes("3.8") || (lower.includes("flash") && !lower.includes("lite"))) return "gemini-3.8-flash";
  if (lower.includes("3.1") || lower.includes("pro")) return "gemini-3.1-pro";
  if (lower.includes("lite") || lower.includes("3.5")) return "gemini-3.5-flash-lite";
  return "gemini-4-argon";
}

/**
 * Resolves the primary model, fallback chain, and thinking budget according to the task category.
 */
export function resolveModelForTask(
  taskCategory: TaskCategory,
  preferredModel?: string
): ModelRoutingResolution {
  const modelKey = normalizeModelKey(preferredModel);
  const primaryModel = REGISTERED_MODEL_CAPABILITIES[modelKey] || REGISTERED_MODEL_CAPABILITIES["gemini-4-argon"];

  const fallbackChain: ModelCapability[] = [];
  let currentFallbackId = primaryModel.fallbackModelId;

  while (currentFallbackId) {
    const fallback = REGISTERED_MODEL_CAPABILITIES[currentFallbackId];
    if (fallback) {
      fallbackChain.push(fallback);
      currentFallbackId = fallback.fallbackModelId;
    } else {
      break;
    }
  }

  // Determine enforced thinking budget based on task category
  let enforcedThinkingBudget = primaryModel.thinkingBudget;
  if (taskCategory === "plan" || taskCategory === "review") {
    enforcedThinkingBudget = Math.max(primaryModel.thinkingBudget, 8192);
  } else if (taskCategory === "ask" || taskCategory === "think") {
    enforcedThinkingBudget = primaryModel.thinkingBudget;
  }

  return {
    primaryModel,
    fallbackChain,
    taskCategory,
    enforcedThinkingBudget,
  };
}
