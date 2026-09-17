import { z } from 'zod';

export const CreatePlanSchema = z.object({
  user_prompt: z.string().min(5, 'User prompt must be descriptive'),
  context_rules: z.string().optional(),
});

export const FetchPhaseSchema = z.object({
  plan_id: z.string().min(1, 'plan_id is required'),
  phase_index: z.number().int().min(1, 'phase_index must be >= 1'),
});

export const UpdateStatusSchema = z.object({
  plan_id: z.string().min(1, 'plan_id is required'),
  phase_index: z.number().int().min(1, 'phase_index must be >= 1'),
  task_id: z.string().min(1, 'task_id is required'),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'skipped']),
});

export const GetSummarySchema = z.object({
  plan_id: z.string().min(1, 'plan_id is required'),
});
