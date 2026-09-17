import { GeminiThinkingClient } from '../gemini/client.js';
import { ArtifactStore } from '../storage/artifact-store.js';
import { PlanSpecification, PlanPhase, PlanTask } from '../types/plan.types.js';
import crypto from 'node:crypto';

export class GeminiOOBPlanner {
  private client: GeminiThinkingClient;
  private artifactStore: ArtifactStore;

  constructor(clientOrApiKey?: GeminiThinkingClient | string, artifactStore?: ArtifactStore) {
    if (clientOrApiKey && typeof clientOrApiKey === 'object' && 'generate' in clientOrApiKey) {
      this.client = clientOrApiKey as GeminiThinkingClient;
    } else {
      this.client = new GeminiThinkingClient(clientOrApiKey as string | undefined);
    }
    this.artifactStore = artifactStore || new ArtifactStore();
  }

  public async generatePlanOOB(prompt: string, contextRules?: string): Promise<string> {
    const planId = `plan-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    const systemInstruction = `You are a Principal Software Architect operating inside an out-of-band execution loop.
Your task is to analyze the user request and generate a deterministic, highly structured JSON plan.
Respond ONLY with a valid, parseable JSON object matching this schema:
{
  "title": "Clear Architectural Title",
  "architecture_summary": "Concise summary of architecture, data flow, and trade-offs.",
  "deep_traps": ["Trap 1 and mitigation", "Trap 2 and mitigation"],
  "quality_gates": ["Acceptance gate 1", "Acceptance gate 2"],
  "review_score": 92,
  "review_verdict": "APPROVED",
  "phases": [
    {
      "phase_index": 1,
      "title": "Phase Title",
      "objective": "Clear phase objective",
      "verification_command": "Concrete shell verification command",
      "status": "pending",
      "tasks": [
        {
          "id": "1.1",
          "description": "Atomic task description",
          "target_file": "path/to/target/file.ts",
          "action_type": "create",
          "status": "pending"
        }
      ]
    }
  ]
}
Do NOT include markdown formatting (\`\`\`json) outside the JSON object. Keep action_type within ["create", "modify", "delete", "test", "exec"].`;

    const userContent = `User Request:
${prompt}

Technical Rules & Architectural Guardrails:
${contextRules || 'Standard MCP + Dual-Token Boundary with Zero Antigravity Context Bloat'}`;

    const response = await this.client.generate(userContent, {
      systemInstruction,
      thinkingBudget: 4096,
      temperature: 0.2,
    });

    const rawText = response.text || '';
    let parsed: any;

    try {
      // Clean possible markdown code fences
      const cleanJson = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      parsed = JSON.parse(cleanJson);
    } catch {
      // Fallback: extract first JSON-like block
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error(`Failed to parse OOB Gemini planning output as JSON.`);
      }
    }

    const phases: PlanPhase[] = Array.isArray(parsed.phases)
      ? parsed.phases.map((p: any, idx: number) => ({
          phase_index: typeof p.phase_index === 'number' ? p.phase_index : idx + 1,
          title: p.title || `Phase ${idx + 1}`,
          objective: p.objective || 'Complete phase tasks',
          verification_command: p.verification_command || 'npm test',
          status: 'pending' as const,
          tasks: Array.isArray(p.tasks)
            ? p.tasks.map((t: any, tIdx: number) => ({
                id: t.id || `${idx + 1}.${tIdx + 1}`,
                description: t.description || 'Task description',
                target_file: t.target_file || 'src/index.ts',
                action_type: (['create', 'modify', 'delete', 'test', 'exec'].includes(t.action_type)
                  ? t.action_type
                  : 'create') as PlanTask['action_type'],
                status: 'pending' as const,
                execution_notes: t.execution_notes,
              }))
            : [],
        }))
      : [];

    const unchecksummedSpec: Omit<PlanSpecification, 'checksum'> = {
      plan_id: planId,
      title: parsed.title || 'Untitled Architecture Plan',
      created_at: new Date().toISOString(),
      model_used: response.model || 'gemini-3.6-flash',
      architecture_summary: parsed.architecture_summary || 'Out-of-band planned architecture.',
      phases,
      deep_traps: Array.isArray(parsed.deep_traps) ? parsed.deep_traps : [],
      quality_gates: Array.isArray(parsed.quality_gates) ? parsed.quality_gates : [],
      review_score: typeof parsed.review_score === 'number' ? parsed.review_score : 90,
      review_verdict: parsed.review_verdict === 'REFINED' ? 'REFINED' : 'APPROVED',
    };

    const saved = await this.artifactStore.savePlan(unchecksummedSpec);
    return saved.plan_id;
  }
}
