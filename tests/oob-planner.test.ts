import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { GeminiOOBPlanner } from '../src/engine/gemini-oob-planner.js';
import { ArtifactStore } from '../src/storage/artifact-store.js';
import { GeminiThinkingClient } from '../src/gemini/client.js';

describe('GeminiOOBPlanner', () => {
  let tempDir: string;
  let store: ArtifactStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'g2a-oob-test-'));
    store = new ArtifactStore(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('should parse generated JSON response, save to artifact store, and return plan_id', async () => {
    const mockJson = {
      title: 'Distributed Event Bus',
      architecture_summary: 'Zero token bloat event bus with Redis Streams.',
      deep_traps: ['Backpressure buffer limits'],
      quality_gates: ['All integration tests pass'],
      review_score: 94,
      review_verdict: 'APPROVED',
      phases: [
        {
          phase_index: 1,
          title: 'Event Bus Schema',
          objective: 'Define event contracts',
          verification_command: 'npm test',
          status: 'pending',
          tasks: [
            {
              id: '1.1',
              description: 'Create event types',
              target_file: 'src/events/types.ts',
              action_type: 'create',
              status: 'pending',
            },
          ],
        },
      ],
    };

    const mockClient = {
      generate: vi.fn().mockResolvedValue({
        text: '```json\n' + JSON.stringify(mockJson) + '\n```',
        model: 'gemini-3.6-flash',
      }),
    } as unknown as GeminiThinkingClient;

    const oobPlanner = new GeminiOOBPlanner(mockClient, store);
    const planId = await oobPlanner.generatePlanOOB('Build distributed event bus');

    expect(planId).toBeDefined();
    expect(planId).toMatch(/^plan-/);

    // Verify artifact saved on disk
    const savedSpec = await store.readPlan(planId);
    expect(savedSpec.title).toBe('Distributed Event Bus');
    expect(savedSpec.checksum).toBeDefined();
    expect(savedSpec.phases).toHaveLength(1);
    expect(savedSpec.phases[0].tasks[0].target_file).toBe('src/events/types.ts');
  });
});
