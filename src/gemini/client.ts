import { GoogleGenAI } from "@google/genai";
import { DEFAULT_GEMINI_MODELS } from "../config/constants.js";
import { getSavedGeminiApiKey } from "../config/paths.js";
import { DynamicModelRegistry } from "./model-registry.js";

export interface GeminiCallOptions {
  model?: string;
  thinkingBudget?: number;
  temperature?: number;
  systemInstruction?: string;
}

export interface GeminiResponse {
  text: string;
  model: string;
  thinking?: string;
}

export class GeminiThinkingClient {
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
            registry.markThrottled(currentModel, 60_000);
            break; // Immediately failover to next candidate model
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
