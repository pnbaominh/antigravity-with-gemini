import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { PlanToolsHandler } from '../src/mcp/tools/plan-tools.js';
import { ArtifactStore } from '../src/storage/artifact-store.js';
import { GeminiOOBPlanner } from '../src/engine/gemini-oob-planner.js';

describe('PlanToolsHandler', () => {
  let tempDir: string;
  let store: ArtifactStore;
  let handler: PlanToolsHandler;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'g2a-tools-test-'));
    store = new ArtifactStore(tempDir);

    // Pre-seed a plan in store
    await store.savePlan({
      plan_id: 'plan-xyz-999',
      title: 'Zero Token Dual Boundary Plan',
      created_at: new Date().toISOString(),
      model_used: 'gemini-3.6-flash',
      architecture_summary: 'Decoupled OOB reasoning engine',
      deep_traps: ['Avoid context bloat'],
      quality_gates: ['Zero compiler diagnostics'],
      review_score: 93,
      review_verdict: 'APPROVED',
      phases: [
        {
          phase_index: 1,
          title: 'Setup Types',
          objective: 'Define interfaces',
          verification_command: 'npm test',
          status: 'pending',
          tasks: [
            {
              id: '1.1',
              description: 'Create types',
              target_file: 'src/types.ts',
              action_type: 'create',
              status: 'pending',
            },
          ],
        },
        {
          phase_index: 2,
          title: 'Setup Tools',
          objective: 'Register MCP tools',
          verification_command: 'npm test',
          status: 'pending',
          tasks: [
            {
              id: '2.1',
              description: 'Create tools handler',
              target_file: 'src/tools.ts',
              action_type: 'create',
              status: 'pending',
            },
          ],
        },
      ],
    });

    const mockPlanner = {
      generatePlanOOB: vi.fn().mockResolvedValue('plan-xyz-999'),
    } as unknown as GeminiOOBPlanner;

    handler = new PlanToolsHandler(store, mockPlanner);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('handleCreatePlan should return a lightweight pointer ticket (< 80 tokens)', async () => {
    const result = await handler.handleCreatePlan({
      user_prompt: 'Implement zero token dual boundary architecture',
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const pointer = JSON.parse(result.content[0].text);
    expect(pointer.status).toBe('READY');
    expect(pointer.plan_id).toBe('plan-xyz-999');
    expect(pointer.total_phases).toBe(2);
    expect(pointer.active_phase_index).toBe(1);
    expect(pointer.token_usage_notice).toContain('0 Antigravity tokens used');

    // Ensure payload size stays very small (< 450 bytes / ~90 tokens)
    expect(result.content[0].text.length).toBeLessThan(450);
  });

  it('handleFetchPhaseJIT should return only the single requested phase', async () => {
    const result = await handler.handleFetchPhaseJIT({
      plan_id: 'plan-xyz-999',
      phase_index: 1,
    });

    const jit = JSON.parse(result.content[0].text);
    expect(jit.plan_id).toBe('plan-xyz-999');
    expect(jit.phase_index).toBe(1);
    expect(jit.phase.title).toBe('Setup Types');
    expect(jit.phase.tasks).toHaveLength(1);
    expect(jit.phase.tasks[0].id).toBe('1.1');

    // Phase 2 should NOT be in this response (no context pollution)
    expect(result.content[0].text).not.toContain('Setup Tools');
  });

  it('handleUpdateStatus should mark task and phase status accurately', async () => {
    const result = await handler.handleUpdateStatus({
      plan_id: 'plan-xyz-999',
      phase_index: 1,
      task_id: '1.1',
      status: 'completed',
    });

    const update = JSON.parse(result.content[0].text);
    expect(update.phase_status).toBe('completed');
    expect(update.task_status).toBe('completed');

    // Verify persisted state in ArtifactStore
    const reloaded = await store.readPlan('plan-xyz-999');
    expect(reloaded.phases[0].status).toBe('completed');
    expect(reloaded.phases[0].tasks[0].status).toBe('completed');
  });

  it('handleGetSummary should return concise status overview', async () => {
    const result = await handler.handleGetSummary({
      plan_id: 'plan-xyz-999',
    });

    const summary = JSON.parse(result.content[0].text);
    expect(summary.plan_id).toBe('plan-xyz-999');
    expect(summary.total_phases).toBe(2);
    expect(summary.phases[0].total_tasks).toBe(1);
    expect(summary.phases[0].completed_tasks).toBe(0);
  });
});
