export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

export interface PlanTask {
  id: string; // e.g., "1.1"
  description: string;
  target_file: string;
  action_type: 'create' | 'modify' | 'delete' | 'test' | 'exec';
  status: TaskStatus;
  execution_notes?: string;
}

export interface PlanPhase {
  phase_index: number;
  title: string;
  objective: string;
  tasks: PlanTask[];
  verification_command: string;
  status: TaskStatus;
}

export interface PlanSpecification {
  plan_id: string; // e.g., "plan-20260224-a1b2c3d4"
  title: string;
  checksum: string; // SHA-256 hash of entire spec
  created_at: string; // ISO 8601
  model_used: string;
  architecture_summary: string;
  phases: PlanPhase[];
  deep_traps: string[];
  quality_gates: string[];
  review_score?: number;
  review_verdict?: 'APPROVED' | 'REFINED';
}

export interface PlanPointerPayload {
  status: 'READY';
  plan_id: string;
  title: string;
  checksum: string;
  total_phases: number;
  active_phase_index: number;
  artifact_path: string;
  review_score?: number;
  token_usage_notice: string; // Notice explaining 0 Antigravity tokens used
}

export interface JITPhaseResponse {
  plan_id: string;
  phase_index: number;
  total_phases: number;
  phase: PlanPhase;
}
