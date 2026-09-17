import { describe, it, expect } from 'vitest';
import { RulesEngine } from '../src/governance/rules-engine.js';
import { GovernancePlanSchema } from '../src/governance/types.js';

describe('RulesEngine', () => {
  it('should accurately calculate PERT expected and standard deviation', () => {
    // O=10, M=14, P=24 -> E = (10 + 56 + 24) / 6 = 90 / 6 = 15.00, sigma = (24 - 10) / 6 = 2.33
    const pert = RulesEngine.calculatePERT(10, 14, 24);
    expect(pert.expectedHours).toBe(15);
    expect(pert.sigmaHours).toBe(2.33);

    expect(() => RulesEngine.calculatePERT(20, 10, 30)).toThrow('Invalid PERT bounds');
  });

  it('should validate a compliant plan successfully', () => {
    const validPlan: GovernancePlanSchema = {
      planId: 'PLAN-001',
      title: 'Valid Governance Plan',
      dri: '@lead_architect',
      asIsEvidence: [
        {
          filePath: 'package.json',
          observation: 'package.json is present and has dependencies defined',
        },
      ],
      nonGoals: [
        'No frontend visual redesign',
        'No database schema migration',
        'No third-party SaaS integration',
      ],
      haltOnUnknownTriggered: false,
      unknownsList: [],
      raidLog: [
        {
          id: 'R-01',
          category: 'Risk',
          description: 'Context bloat risk',
          impact: 'High',
          likelihood: 'Medium',
          mitigationStrategy: 'Use Zero-Token Pointer and JIT phase fetching',
          ownerDRI: '@lead_architect',
        },
      ],
      wbsNodes: [
        {
          id: '1.1',
          title: 'Core Engine Setup',
          dri: '@lead_architect',
          estimatedHours: RulesEngine.calculatePERT(8, 16, 24), // E = 16
          dependencies: [],
          binaryAcceptanceCriteria: ['Unit test passes 100%'],
          isCompleted: false,
        },
      ],
      definitionOfDone: ['100% unit tests pass', 'Zero compiler warnings'],
    };

    const result = RulesEngine.validatePlan(validPlan, process.cwd());
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.haltRequired).toBe(false);
  });

  it('should enforce Halt-on-Unknown protocol when unknowns are detected', () => {
    const unknownPlan: GovernancePlanSchema = {
      planId: 'PLAN-002',
      title: 'Ambiguous Plan',
      dri: '@lead_architect',
      asIsEvidence: [{ filePath: 'package.json', observation: 'exists' }],
      nonGoals: ['NG1', 'NG2', 'NG3'],
      haltOnUnknownTriggered: true,
      unknownsList: ['Missing production database connection string'],
      raidLog: [
        {
          id: 'R-01',
          category: 'Risk',
          description: 'Risk',
          impact: 'High',
          likelihood: 'High',
          mitigationStrategy: 'Mitigate',
          ownerDRI: '@lead',
        },
      ],
      wbsNodes: [
        {
          id: '1.1',
          title: 'Task',
          dri: '@lead',
          estimatedHours: RulesEngine.calculatePERT(4, 8, 12),
          dependencies: [],
          binaryAcceptanceCriteria: ['Pass/fail check'],
          isCompleted: false,
        },
      ],
      definitionOfDone: ['Done'],
    };

    const result = RulesEngine.validatePlan(unknownPlan);
    expect(result.valid).toBe(false);
    expect(result.haltRequired).toBe(true);
    expect(result.violations[0]).toContain('Halt-on-Unknown triggered');
  });

  it('should catch non-goals violations and missing DRIs', () => {
    const invalidPlan: GovernancePlanSchema = {
      planId: 'PLAN-003',
      title: 'Incomplete Plan',
      dri: '',
      asIsEvidence: [],
      // @ts-expect-error - testing invalid non-goals length
      nonGoals: ['Only one non-goal'],
      haltOnUnknownTriggered: false,
      unknownsList: [],
      raidLog: [],
      wbsNodes: [
        {
          id: '1.1',
          title: 'Task missing DRI and AC',
          dri: '',
          // @ts-expect-error - testing missing hours
          estimatedHours: undefined,
          dependencies: [],
          binaryAcceptanceCriteria: [],
          isCompleted: false,
        },
      ],
      definitionOfDone: [],
    };

    const result = RulesEngine.validatePlan(invalidPlan);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.includes('Non-Goals invariant violated'))).toBe(true);
    expect(result.violations.some((v) => v.includes('AS-IS Evidence invariant violated'))).toBe(true);
    expect(result.violations.some((v) => v.includes('Single DRI rule'))).toBe(true);
    expect(result.violations.some((v) => v.includes('Binary AC rule'))).toBe(true);
    expect(result.violations.some((v) => v.includes('RAID Log invariant violated'))).toBe(true);
  });
});
