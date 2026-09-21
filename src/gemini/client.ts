import { GoogleGenAI } from "@google/genai";
import { DEFAULT_GEMINI_MODELS } from "../config/constants.js";
import { getSavedGeminiApiKey } from "../config/paths.js";
import { DynamicModelRegistry } from "./model-registry.js";
import type { GeminiGenerationClient, GenerateOptions, GenerateResult } from "./client-interface.js";
import { GeminiWebClient } from "../browser/gemini-web-client.js";

export interface GeminiCallOptions extends GenerateOptions {}

export interface GeminiResponse extends GenerateResult {
  thinking?: string;
}

export class GeminiThinkingClient implements GeminiGenerationClient {
  private client: GoogleGenAI | null = null;
  private apiKey: string | null = null;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || getSavedGeminiApiKey() || null;
    if (this.apiKey) {
      this.client = new GoogleGenAI({ apiKey: this.apiKey });
    }
  }

  isConfigured(): boolean {
    if (!this.apiKey) {
      const saved = getSavedGeminiApiKey();
      if (saved) {
        this.setApiKey(saved);
      }
    }
    return !!this.apiKey;
  }

  setApiKey(key: string) {
    this.apiKey = key;
    this.client = new GoogleGenAI({ apiKey: key });
  }

  getModelRegistry(): DynamicModelRegistry {
    return DynamicModelRegistry.getInstance();
  }

  getRawClient(): GoogleGenAI | null {
    this.isConfigured();
    return this.client;
  }

  async generate(
    prompt: string,
    options: GeminiCallOptions = {}
  ): Promise<GeminiResponse> {
    if (!this.client) {
      const saved = getSavedGeminiApiKey();
      if (saved) {
        this.setApiKey(saved);
      }
    }

    const client = this.client;
    if (!client) {
      throw new Error(
        "GEMINI_API_KEY is not configured. Set GEMINI_API_KEY in environment or run `g2a setup --api-key <key>`."
      );
    }

    const modelName = options.model || DEFAULT_GEMINI_MODELS.THINKING;
    const thinkingBudget = options.thinkingBudget ?? 4096;

    const config: Record<string, any> = {};

    if (options.systemInstruction) {
      config.systemInstruction = options.systemInstruction;
    }

    // Enable thinking configuration for reasoning models
    if (thinkingBudget > 0) {
      config.thinkingConfig = {
        thinkingBudget,
      };
    }

    if (options.temperature !== undefined) {
      config.temperature = options.temperature;
    }

    const registry = DynamicModelRegistry.getInstance();
    const candidateModels = registry.getCandidateModels(modelName);

    let lastError: any;
    for (const currentModel of candidateModels) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const modelConfig = { ...config };
        try {
          const response = await client.models.generateContent({
            model: currentModel,
            contents: prompt,
            config: modelConfig,
          });

          const text = response.text || "";
          return {
            text,
            model: currentModel,
          };
        } catch (error: any) {
          lastError = error;
          const errMsg = error?.message || String(error);

          // If quota exhausted (429) or unavailable (503), throttle this model and failover immediately
          if (errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED")) {
            const isDailyQuota =
              errMsg.includes("GenerateRequestsPerDay") ||
              errMsg.includes("free_tier_requests") ||
              errMsg.includes("per_day");
            const cooldownMs = isDailyQuota ? 12 * 60 * 60 * 1000 : 60_000;
            registry.markThrottled(currentModel, cooldownMs);
            break; // Immediately failover to next candidate model
          }

          if (errMsg.includes("streaming") || errMsg.includes("only supports real-time") || errMsg.includes("not supported for generateContent")) {
            registry.markThrottled(currentModel, 24 * 60 * 60 * 1000);
            break; // Skip non-generateContent models
          }

          if (errMsg.includes("503") || errMsg.includes("UNAVAILABLE") || errMsg.includes("high demand")) {
            registry.markThrottled(currentModel, 30_000);
            if (attempt === 0) {
              // Quick 1s retry before failing over
              await new Promise((r) => setTimeout(r, 1000));
              continue;
            }
            break; // Failover to next candidate model
          }

          // If thinking mode is not supported by chosen model, retry without thinkingConfig
          if (errMsg.includes("thinkingConfig") || errMsg.includes("not supported")) {
            delete modelConfig.thinkingConfig;
            try {
              const retryResponse = await client.models.generateContent({
                model: currentModel,
                contents: prompt,
                config: modelConfig,
              });
              return {
                text: retryResponse.text || "",
                model: currentModel,
              };
            } catch (retryError) {
              lastError = retryError;
            }
          }
          break; // move to next candidate model
        }
      }
    }

    throw lastError;
  }
}

/**
 * Creates the appropriate Gemini client according to configuration.
 * Prioritizes GeminiWebClient to bypass Studio API quotas unless explicitly set to 'api'.
 */
export function createDefaultClient(preferredModel?: string): GeminiGenerationClient {
  const engine = (process.env.GEMINI_ENGINE || "web").toLowerCase();
  if (engine === "api") {
    const apiClient = new GeminiThinkingClient();
    if (apiClient.isConfigured()) {
      return apiClient;
    }
  }
  return new GeminiWebClient({
    preferredModel: preferredModel || process.env.GEMINI_MODEL || "3.8 Flash",
  });
}
