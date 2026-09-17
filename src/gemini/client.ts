import { GoogleGenAI } from "@google/genai";
import { DEFAULT_GEMINI_MODELS } from "../config/constants.js";

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
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || null;
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

    try {
      const response = await this.client.models.generateContent({
        model: modelName,
        contents: prompt,
        config,
      });

      const text = response.text || "";
      return {
        text,
        model: modelName,
      };
    } catch (error: any) {
      // If thinking mode is not supported by chosen model, retry without thinkingConfig
      if (error?.message?.includes("thinkingConfig") || error?.message?.includes("not supported")) {
        delete config.thinkingConfig;
        const retryResponse = await this.client.models.generateContent({
          model: modelName,
          contents: prompt,
          config,
        });
        return {
          text: retryResponse.text || "",
          model: modelName,
        };
      }
      throw error;
    }
  }
}
