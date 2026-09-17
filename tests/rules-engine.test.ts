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

  it('should parse and validate a compliant RULES.MD markdown document', () => {
    const compliantMarkdown = `# Plan: Core Governance Engine
DRI: @lead_architect

## 1. AS-IS State & Evidence Grounding
- \`package.json\`: Workspace root descriptor with vitest configured
- \`RULES.md\`: Technical governance specification

## 2. Non-Goals & Scope Boundaries (Mandatory >= 3)
- No migration of legacy tests to Jest
- No external web dashboard UI implementation
- No modification of Gemini API auth credentials flow

## 3. Unknowns & Halt Checks
- Status: CLEAR
- Unknowns: None

## 4. Pre-Mortem & RAID Log
| ID | Category | Description | Impact | Likelihood | Mitigation | Owner DRI |
| RAID-1 | Risk | Windows CRLF causing test diff mismatch | High | Medium | Force LF in git attributes | @lead_architect |

## 5. Work Breakdown Structure (WBS) & Phased Implementation
### Phase 1: Foundation Parser
- [ ] Task 1.1: Implement markdown parser for governance schema
- [ ] Task 1.2: Add unit tests for parser
**Verification:** npm test tests/rules-engine.test.ts
PERT: O=1, M=2, P=3

## 6. Definition of Done & Acceptance Criteria
- 100% test pass rate
- Zero build errors
`;

    const parsed = RulesEngine.parseMarkdownPlan(compliantMarkdown);
    expect(parsed.title).toBe('Core Governance Engine');
    expect(parsed.dri).toBe('@lead_architect');
    expect(parsed.asIsEvidence).toHaveLength(2);
    expect(parsed.nonGoals).toHaveLength(3);
    expect(parsed.haltOnUnknownTriggered).toBe(false);
    expect(parsed.raidLog).toHaveLength(1);
    expect(parsed.wbsNodes.length).toBeGreaterThanOrEqual(1);

    const validation = RulesEngine.validateMarkdownPlan(compliantMarkdown, process.cwd());
    expect(validation.valid).toBe(true);
    expect(validation.violations).toHaveLength(0);
    expect(validation.haltRequired).toBe(false);
  });

  it('should trigger Halt-on-Unknown when markdown declares unknown parameters', () => {
    const markdownWithHalt = `# Plan: Production Deployment
DRI: @devops

## 1. AS-IS State & Evidence Grounding
- \`package.json\`: Project manifest

## 2. Non-Goals & Scope Boundaries
- No frontend rebuild
- No rollback pipeline
- No staging environment

## 3. Unknowns & Halt Checks
- Status: HALT
- Missing AWS production KMS key ARN
- Database connection password not provisioned in vault

## 4. Pre-Mortem & RAID Log
| ID | Category | Description | Impact | Likelihood | Mitigation | Owner DRI |
| R-1 | Risk | Secret leak | High | Low | Use vault | @devops |

## 5. Phased Implementation Plan
### Phase 1: Deploy
- [ ] Task 1.1: Execute deploy script
**Verification:** npm run verify
`;

    const validation = RulesEngine.validateMarkdownPlan(markdownWithHalt);
    expect(validation.valid).toBe(false);
    expect(validation.haltRequired).toBe(true);
    expect(validation.violations[0]).toContain('Halt-on-Unknown triggered');
  });
});

