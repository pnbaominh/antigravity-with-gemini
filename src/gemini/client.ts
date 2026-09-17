import { GoogleGenAI } from "@google/genai";
import { DEFAULT_GEMINI_MODELS } from "../config/constants.js";
import { getSavedGeminiApiKey } from "../config/paths.js";

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
    return !!this.apiKey;
  }

  setApiKey(key: string) {
    this.apiKey = key;
    this.client = new GoogleGenAI({ apiKey: key });
  }

  async generate(
    prompt: string,
    options: GeminiCallOptions = {}
  ): Promise<GeminiResponse> {
    if (!this.client) {
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

    if (typeof options.temperature === "number") {
      config.temperature = options.temperature;
    }

    const fallbackModels = [modelName, DEFAULT_GEMINI_MODELS.FAST, "gemini-3.6-flash"].filter(
      (m, idx, arr) => arr.indexOf(m) === idx
    );

    let lastError: any;
    for (const currentModel of fallbackModels) {
      try {
        const response = await this.client.models.generateContent({
          model: currentModel,
          contents: prompt,
          config,
        });

        const text = response.text || "";
        return {
          text,
          model: currentModel,
        };
      } catch (error: any) {
        lastError = error;
        // If thinking mode is not supported by chosen model, retry without thinkingConfig
        if (error?.message?.includes("thinkingConfig") || error?.message?.includes("not supported")) {
          delete config.thinkingConfig;
          try {
            const retryResponse = await this.client.models.generateContent({
              model: currentModel,
              contents: prompt,
              config,
            });
            return {
              text: retryResponse.text || "",
              model: currentModel,
            };
          } catch (retryErr: any) {
            lastError = retryErr;
          }
        }
      }
    }

    throw lastError;
  }
}
