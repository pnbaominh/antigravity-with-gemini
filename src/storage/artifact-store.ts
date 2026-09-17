import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { PlanSpecification, PlanPointerPayload, TaskStatus } from '../types/plan.types.js';

export class ArtifactStore {
  private readonly rootDir: string;

  constructor(workspacePath: string = process.cwd()) {
    this.rootDir = path.resolve(workspacePath, '.g2a', 'plans');
  }

  public async init(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  public getPlanPath(planId: string, ext: 'json' | 'md' = 'json'): string {
    // Path traversal protection: isolate basename and strip illegal characters
    const sanitizedId = path.basename(planId).replace(/[^a-zA-Z0-9_-]/g, '');
    return path.join(this.rootDir, `${sanitizedId}.${ext}`);
  }

  /**
   * Performs an atomic write using a temporary file and atomic rename.
   * Prevents partial read or corrupt states during concurrent operations.
   */
  private async atomicWrite(targetPath: string, content: string): Promise<void> {
    const dir = path.dirname(targetPath);
    await fs.mkdir(dir, { recursive: true });
    const tempPath = `${targetPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, targetPath);
  }

  public async savePlan(spec: Omit<PlanSpecification, 'checksum'>): Promise<PlanSpecification> {
    await this.init();
    const jsonString = JSON.stringify(spec, null, 2);
    const checksum = crypto.createHash('sha256').update(jsonString).digest('hex');

    const finalSpec: PlanSpecification = { ...spec, checksum };
    const jsonPath = this.getPlanPath(spec.plan_id, 'json');
    const mdPath = this.getPlanPath(spec.plan_id, 'md');

    // Atomically write JSON data representation
    await this.atomicWrite(jsonPath, JSON.stringify(finalSpec, null, 2));

    // Atomically write Markdown presentation artifact for inspection
    const markdownContent = this.formatPlanToMarkdown(finalSpec);
    await this.atomicWrite(mdPath, markdownContent);

    return finalSpec;
  }

  public async readPlan(planId: string): Promise<PlanSpecification> {
    const jsonPath = this.getPlanPath(planId, 'json');
    try {
      const raw = await fs.readFile(jsonPath, 'utf-8');
      return JSON.parse(raw) as PlanSpecification;
    } catch (err) {
      throw new Error(`Plan artifact non-existent or unreadable: ${planId} (${(err as Error).message})`);
    }
  }

  public async getPlanPointer(planId: string): Promise<PlanPointerPayload> {
    const spec = await this.readPlan(planId);
    const activePhase = spec.phases.find((p) => p.status === 'in_progress') || spec.phases[0];
    const activePhaseIndex = activePhase ? activePhase.phase_index : 1;

    return {
      status: 'READY',
      plan_id: spec.plan_id,
      title: spec.title,
      checksum: spec.checksum,
      total_phases: spec.phases.length,
      active_phase_index: activePhaseIndex,
      artifact_path: this.getPlanPath(spec.plan_id, 'md').replace(/\\/g, '/'),
      review_score: spec.review_score,
      token_usage_notice: 'Zero Antigravity tokens consumed for planning. Retrieve phase tasks on demand using JIT phase fetching.',
    };
  }

  public async updateTaskStatus(
    planId: string,
    phaseIndex: number,
    taskId: string,
    status: TaskStatus
  ): Promise<PlanSpecification> {
    const spec = await this.readPlan(planId);
    const phase = spec.phases.find((p) => p.phase_index === phaseIndex);
    if (!phase) throw new Error(`Phase ${phaseIndex} not found in plan ${planId}`);

    const task = phase.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found in phase ${phaseIndex}`);

    task.status = status;

    // Evaluate phase status based on tasks
    if (phase.tasks.every((t) => t.status === 'completed')) {
      phase.status = 'completed';
    } else if (phase.tasks.some((t) => t.status === 'failed')) {
      phase.status = 'failed';
    } else if (phase.tasks.some((t) => t.status === 'in_progress')) {
      phase.status = 'in_progress';
    }

    return await this.savePlan(spec);
  }

  public formatPlanToMarkdown(spec: PlanSpecification): string {
    const scoreBadge = spec.review_score
      ? `> 🛡️ **Gemini Architect Score:** ${spec.review_score}/100 (${spec.review_verdict || 'Approved'})\n\n`
      : '';

    const trapsSection = spec.deep_traps && spec.deep_traps.length > 0
      ? `## Technical Traps & Guardrails\n` + spec.deep_traps.map((t) => `- ⚠️ ${t}`).join('\n') + '\n\n'
      : '';

    const gatesSection = spec.quality_gates && spec.quality_gates.length > 0
      ? `## Quality Gates & Acceptance\n` + spec.quality_gates.map((g) => `- [ ] ${g}`).join('\n') + '\n\n'
      : '';

    return (
      `# Architecture Plan: ${spec.title}\n\n` +
      scoreBadge +
      `**ID:** \`${spec.plan_id}\`  \n` +
      `**Checksum:** \`${spec.checksum}\`  \n` +
      `**Created:** ${spec.created_at}  \n` +
      `**Model:** ${spec.model_used}  \n\n` +
      `## Architecture Summary\n${spec.architecture_summary}\n\n` +
      trapsSection +
      `## Implementation Phases\n` +
      spec.phases
        .map(
          (p) =>
            `### Phase ${p.phase_index}: ${p.title} [Status: ${p.status}]\n` +
            `**Objective:** ${p.objective}\n` +
            `**Verification:** \`${p.verification_command}\`\n\n` +
            `**Tasks:**\n` +
            p.tasks
              .map(
                (t) =>
                  `- [${t.status === 'completed' ? 'x' : ' '}] **${t.id}** [${t.action_type}] \`${t.target_file}\`: ${t.description}`
              )
              .join('\n')
        )
        .join('\n\n') +
      '\n\n' +
      gatesSection
    );
  }
}
