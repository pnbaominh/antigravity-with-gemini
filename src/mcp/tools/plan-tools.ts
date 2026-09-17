import { ArtifactStore } from '../../storage/artifact-store.js';
import { GeminiOOBPlanner } from '../../engine/gemini-oob-planner.js';
import {
  CreatePlanSchema,
  FetchPhaseSchema,
  UpdateStatusSchema,
  GetSummarySchema,
} from '../schemas/plan-mcp.schema.js';
import { PlanPointerPayload, JITPhaseResponse } from '../../types/plan.types.js';

export class PlanToolsHandler {
  constructor(
    private artifactStore: ArtifactStore,
    private planner: GeminiOOBPlanner
  ) {}

  public async handleCreatePlan(
    args: unknown
  ): Promise<{ content: { type: 'text'; text: string }[] }> {
    const input = CreatePlanSchema.parse(args);

    // Out-of-band reasoning runs via Gemini 3.6 Flash - consumes 0 tokens in Antigravity context
    const planId = await this.planner.generatePlanOOB(input.user_prompt, input.context_rules);
    const spec = await this.artifactStore.readPlan(planId);

    // Zero-Token Pointer Payload construct (< 80 Tokens)
    const pointer: PlanPointerPayload = {
      status: 'READY',
      plan_id: spec.plan_id,
      title: spec.title,
      checksum: spec.checksum,
      total_phases: spec.phases.length,
      active_phase_index: spec.phases.length > 0 ? 1 : 0,
      artifact_path: `.g2a/plans/${spec.plan_id}.md`,
      review_score: spec.review_score,
      token_usage_notice: '0 Antigravity tokens used. Call fetch_phase_jit for Phase 1.',
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(pointer) }],
    };
  }

  public async handleFetchPhaseJIT(
    args: unknown
  ): Promise<{ content: { type: 'text'; text: string }[] }> {
    const input = FetchPhaseSchema.parse(args);
    const spec = await this.artifactStore.readPlan(input.plan_id);

    const phase = spec.phases.find((p) => p.phase_index === input.phase_index);
    if (!phase) {
      throw new Error(
        `Requested phase index ${input.phase_index} out of bounds for plan ${input.plan_id}. Total phases: ${spec.phases.length}`
      );
    }

    const response: JITPhaseResponse = {
      plan_id: spec.plan_id,
      phase_index: phase.phase_index,
      total_phases: spec.phases.length,
      phase,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
    };
  }

  public async handleUpdateStatus(
    args: unknown
  ): Promise<{ content: { type: 'text'; text: string }[] }> {
    const input = UpdateStatusSchema.parse(args);
    const updatedSpec = await this.artifactStore.updateTaskStatus(
      input.plan_id,
      input.phase_index,
      input.task_id,
      input.status
    );

    const phase = updatedSpec.phases.find((p) => p.phase_index === input.phase_index);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              plan_id: updatedSpec.plan_id,
              phase_index: input.phase_index,
              phase_status: phase?.status || 'unknown',
              task_id: input.task_id,
              task_status: input.status,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  public async handleGetSummary(
    args: unknown
  ): Promise<{ content: { type: 'text'; text: string }[] }> {
    const input = GetSummarySchema.parse(args);
    const spec = await this.artifactStore.readPlan(input.plan_id);

    const summary = {
      plan_id: spec.plan_id,
      title: spec.title,
      checksum: spec.checksum,
      model_used: spec.model_used,
      total_phases: spec.phases.length,
      phases: spec.phases.map((p) => ({
        phase_index: p.phase_index,
        title: p.title,
        status: p.status,
        total_tasks: p.tasks.length,
        completed_tasks: p.tasks.filter((t) => t.status === 'completed').length,
      })),
      artifact_path: `.g2a/plans/${spec.plan_id}.md`,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
    };
  }
}
