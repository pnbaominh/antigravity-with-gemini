import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { ArtifactStore } from '../src/storage/artifact-store.js';
import { PlanToolsHandler } from '../src/mcp/tools/plan-tools.js';
import { GeminiOOBPlanner } from '../src/engine/gemini-oob-planner.js';

describe('Dual-Token Boundary End-to-End & Token Leakage Audit', () => {
  let tempDir: string;
  let store: ArtifactStore;
  let handler: PlanToolsHandler;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'g2a-e2e-test-'));
    store = new ArtifactStore(tempDir);

    // Mock planner that simulates OOB Gemini generation
    const mockPlanner = {
      generatePlanOOB: async (prompt: string) => {
        const plan = await store.savePlan({
          plan_id: 'plan-e2e-404',
          title: `Architecture Plan for ${prompt}`,
          created_at: new Date().toISOString(),
          model_used: 'gemini-3.6-flash',
          architecture_summary: 'Dual Token Boundary Architecture with JIT Phase Delivery.',
          deep_traps: ['Avoid context bloat', 'Cross-platform path normalization'],
          quality_gates: ['All tests pass 100%'],
          review_score: 96,
          review_verdict: 'APPROVED',
          phases: [
            {
              phase_index: 1,
              title: 'Initialize Infrastructure',
              objective: 'Setup DB and cache connections',
              verification_command: 'npm run test:infra',
              status: 'pending',
              tasks: [
                {
                  id: '1.1',
                  description: 'Setup database schema',
                  target_file: 'src/db/schema.ts',
                  action_type: 'create',
                  status: 'pending',
                },
              ],
            },
            {
              phase_index: 2,
              title: 'API Handlers',
              objective: 'Implement CRUD routes',
              verification_command: 'npm run test:api',
              status: 'pending',
              tasks: [
                {
                  id: '2.1',
                  description: 'Add user routes',
                  target_file: 'src/routes/user.ts',
                  action_type: 'create',
                  status: 'pending',
                },
              ],
            },
          ],
        });
        return plan.plan_id;
      },
    } as unknown as GeminiOOBPlanner;

    handler = new PlanToolsHandler(store, mockPlanner);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('Step 1 -> Step 5: Full E2E Workflow with Strict Token Leakage Audit', async () => {
    // Step 1: Create Plan OOB
    const createResult = await handler.handleCreatePlan({
      user_prompt: 'Build resilient user microservice',
    });
    const pointerText = createResult.content[0].text;
    const pointer = JSON.parse(pointerText);

    // TOKEN LEAKAGE AUDIT:
    // Standard rule: 1 token ~= 4 characters in English JSON.
    // Ensure pointer payload strictly < 100 tokens (i.e. < 400 characters).
    const estimatedTokens = Math.ceil(pointerText.length / 4);
    expect(estimatedTokens).toBeLessThan(100);
    expect(pointer.status).toBe('READY');
    expect(pointer.plan_id).toBe('plan-e2e-404');
    expect(pointer.total_phases).toBe(2);

    // Step 2: Fetch Phase 1 via JIT
    const phase1Result = await handler.handleFetchPhaseJIT({
      plan_id: pointer.plan_id,
      phase_index: 1,
    });
    const phase1Data = JSON.parse(phase1Result.content[0].text);
    expect(phase1Data.phase.title).toBe('Initialize Infrastructure');
    expect(phase1Data.phase.status).toBe('pending');

    // Context Isolation check: Phase 2 tasks should NOT exist in Phase 1 payload
    expect(phase1Result.content[0].text).not.toContain('API Handlers');
    expect(phase1Result.content[0].text).not.toContain('src/routes/user.ts');

    // Step 3: Execute Task 1.1 and Mark Complete
    const updateResult = await handler.handleUpdateStatus({
      plan_id: pointer.plan_id,
      phase_index: 1,
      task_id: '1.1',
      status: 'completed',
    });
    const updateData = JSON.parse(updateResult.content[0].text);
    expect(updateData.phase_status).toBe('completed');
    expect(updateData.task_status).toBe('completed');

    // Step 4: Fetch Phase 2 via JIT
    const phase2Result = await handler.handleFetchPhaseJIT({
      plan_id: pointer.plan_id,
      phase_index: 2,
    });
    const phase2Data = JSON.parse(phase2Result.content[0].text);
    expect(phase2Data.phase.title).toBe('API Handlers');
    expect(phase2Data.phase.tasks[0].target_file).toBe('src/routes/user.ts');

    // Step 5: Verify Final Plan Summary
    const summaryResult = await handler.handleGetSummary({
      plan_id: pointer.plan_id,
    });
    const summaryData = JSON.parse(summaryResult.content[0].text);
    expect(summaryData.phases[0].status).toBe('completed');
    expect(summaryData.phases[1].status).toBe('pending');
  });

  it('Cross-Platform Path Audit: handles Windows and POSIX path separators', () => {
    const windowsPath = store.getPlanPath('plan-test\\nested', 'json');
    expect(windowsPath).not.toContain('..');

    const posixPath = store.getPlanPath('plan-test/nested', 'json');
    expect(posixPath).not.toContain('..');

    expect(path.basename(windowsPath)).toBe('nested.json');
    expect(path.basename(posixPath)).toBe('nested.json');
  });
});
