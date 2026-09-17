import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { ArtifactStore } from '../src/storage/artifact-store.js';
import { PlanSpecification } from '../src/types/plan.types.js';

describe('ArtifactStore', () => {
  let tempDir: string;
  let store: ArtifactStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'g2a-artifact-test-'));
    store = new ArtifactStore(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  const sampleSpec: Omit<PlanSpecification, 'checksum'> = {
    plan_id: 'plan-test-001',
    title: 'Dual Token Boundary Architecture',
    created_at: new Date().toISOString(),
    model_used: 'gemini-3.6-flash',
    architecture_summary: 'Decoupled out-of-band reasoning with JIT phase fetching.',
    deep_traps: ['Avoid path traversal in artifact paths', 'Use atomic rename to avoid race conditions'],
    quality_gates: ['All unit tests pass', 'Zero TypeScript compiler errors'],
    review_score: 95,
    review_verdict: 'APPROVED',
    phases: [
      {
        phase_index: 1,
        title: 'Core Storage Engine',
        objective: 'Setup file artifact storage with checksum',
        verification_command: 'npm test tests/artifact-store.test.ts',
        status: 'pending',
        tasks: [
          {
            id: '1.1',
            description: 'Define Plan interfaces',
            target_file: 'src/types/plan.types.ts',
            action_type: 'create',
            status: 'pending',
          },
          {
            id: '1.2',
            description: 'Implement ArtifactStore',
            target_file: 'src/storage/artifact-store.ts',
            action_type: 'create',
            status: 'pending',
          },
        ],
      },
    ],
  };

  it('should save plan atomically and generate SHA-256 checksum', async () => {
    const saved = await store.savePlan(sampleSpec);

    expect(saved.checksum).toBeDefined();
    expect(saved.checksum).toHaveLength(64); // SHA-256 hex string

    // JSON file should exist and match
    const jsonPath = store.getPlanPath(sampleSpec.plan_id, 'json');
    expect(fs.existsSync(jsonPath)).toBe(true);
    const diskJson = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    expect(diskJson.checksum).toBe(saved.checksum);
    expect(diskJson.title).toBe(sampleSpec.title);

    // Markdown presentation file should also exist
    const mdPath = store.getPlanPath(sampleSpec.plan_id, 'md');
    expect(fs.existsSync(mdPath)).toBe(true);
    const diskMd = fs.readFileSync(mdPath, 'utf-8');
    expect(diskMd).toContain('Dual Token Boundary Architecture');
    expect(diskMd).toContain('95/100');
  });

  it('should guard against path traversal in plan ID', () => {
    const maliciousId = '../../../etc/passwd';
    const resolvedPath = store.getPlanPath(maliciousId, 'json');

    // Path must stay strictly within .g2a/plans/
    expect(resolvedPath).toContain(path.join('.g2a', 'plans'));
    expect(resolvedPath).not.toContain('..');
    expect(path.basename(resolvedPath)).toBe('passwd.json');
  });

  it('should generate a lightweight pointer payload (< 100 tokens)', async () => {
    await store.savePlan(sampleSpec);
    const pointer = await store.getPlanPointer(sampleSpec.plan_id);

    expect(pointer.status).toBe('READY');
    expect(pointer.plan_id).toBe('plan-test-001');
    expect(pointer.total_phases).toBe(1);
    expect(pointer.active_phase_index).toBe(1);
    expect(pointer.artifact_path).toContain('plan-test-001.md');
    expect(pointer.review_score).toBe(95);

    const serialized = JSON.stringify(pointer);
    // Payload should be very compact (~400 bytes, well under 100 tokens)
    expect(serialized.length).toBeLessThan(500);
  });

  it('should update task status and automatically update phase status', async () => {
    await store.savePlan(sampleSpec);

    // Mark task 1.1 in_progress
    let updated = await store.updateTaskStatus('plan-test-001', 1, '1.1', 'in_progress');
    expect(updated.phases[0].tasks[0].status).toBe('in_progress');
    expect(updated.phases[0].status).toBe('in_progress');

    // Complete task 1.1
    updated = await store.updateTaskStatus('plan-test-001', 1, '1.1', 'completed');
    expect(updated.phases[0].tasks[0].status).toBe('completed');
    expect(updated.phases[0].status).toBe('in_progress'); // task 1.2 is still pending

    // Complete task 1.2 -> entire phase should now be completed
    updated = await store.updateTaskStatus('plan-test-001', 1, '1.2', 'completed');
    expect(updated.phases[0].tasks[1].status).toBe('completed');
    expect(updated.phases[0].status).toBe('completed');
  });
});
