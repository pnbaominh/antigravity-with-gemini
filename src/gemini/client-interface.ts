export interface GenerateOptions {
  model?: string;
  systemInstruction?: string;
  thinkingBudget?: number;
  temperature?: number;
  continueConversation?: boolean;
}

export interface GenerateResult {
  text: string;
  model: string;
}

export interface GeminiGenerationClient {
  isConfigured(): boolean;
  generate(prompt: string, options?: GenerateOptions): Promise<GenerateResult>;
}
