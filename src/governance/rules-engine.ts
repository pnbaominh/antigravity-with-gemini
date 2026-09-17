import fs from 'node:fs';
import path from 'node:path';
import {
  GovernancePlanSchema,
  RuleValidationResult,
  PERTEstimate,
  WBSNode,
} from './types.js';

export class RulesEngine {
  private static readonly EPSILON = 0.05; // Precision variance tolerance

  public static calculatePERT(O: number, M: number, P: number): PERTEstimate {
    if (O < 0 || M < O || P < M) {
      throw new Error(`Invalid PERT bounds: O=${O}, M=${M}, P=${P}. Must satisfy 0 <= O <= M <= P.`);
    }
    const expectedHours = Number(((O + 4 * M + P) / 6).toFixed(2));
    const sigmaHours = Number(((P - O) / 6).toFixed(2));
    return {
      optimisticHours: O,
      mostLikelyHours: M,
      pessimisticHours: P,
      expectedHours,
      sigmaHours,
    };
  }

  public static calculateTotalPERT(nodes: WBSNode[]): PERTEstimate {
    let totalO = 0;
    let totalM = 0;
    let totalP = 0;
    let varianceSum = 0;

    for (const node of nodes) {
      const { optimisticHours, mostLikelyHours, pessimisticHours, sigmaHours } = node.estimatedHours;
      totalO += optimisticHours;
      totalM += mostLikelyHours;
      totalP += pessimisticHours;
      varianceSum += Math.pow(sigmaHours, 2);
    }

    const expectedHours = Number(((totalO + 4 * totalM + totalP) / 6).toFixed(2));
    const sigmaHours = Number(Math.sqrt(varianceSum).toFixed(2));

    return {
      optimisticHours: totalO,
      mostLikelyHours: totalM,
      pessimisticHours: totalP,
      expectedHours,
      sigmaHours,
    };
  }

  public static validatePlan(
    plan: GovernancePlanSchema,
    workspaceRoot?: string
  ): RuleValidationResult {
    const violations: string[] = [];

    // 1. Halt-on-Unknown Axiom Check
    if (plan.haltOnUnknownTriggered || (plan.unknownsList && plan.unknownsList.length > 0)) {
      return {
        valid: false,
        violations: [
          `Halt-on-Unknown triggered with ${plan.unknownsList?.length || 1} unverified items: ${plan.unknownsList?.join('; ') || 'Critical unknown encountered.'}`,
        ],
        haltRequired: true,
      };
    }

    // 2. Non-Goals Axiom Check (Min 3)
    if (!plan.nonGoals || plan.nonGoals.length < 3) {
      violations.push(
        `Non-Goals invariant violated: Expected at least 3 non-goals, found ${plan.nonGoals?.length ?? 0}.`
      );
    }

    // 3. Grounding Evidence AS-IS Verification
    if (!plan.asIsEvidence || plan.asIsEvidence.length === 0) {
      violations.push('AS-IS Evidence invariant violated: Plan lacks grounded context evidence.');
    } else if (workspaceRoot) {
      for (const evidence of plan.asIsEvidence) {
        const fullPath = path.resolve(workspaceRoot, evidence.filePath);
        if (!fs.existsSync(fullPath)) {
          violations.push(`AS-IS Evidence error: Referenced grounded file does not exist: ${evidence.filePath}`);
        }
      }
    }

    // 4. WBS 8/80 & Single DRI & Binary AC Checks
    if (!plan.wbsNodes || plan.wbsNodes.length === 0) {
      violations.push('WBS invariant violated: Plan must contain at least 1 WBS task node.');
    } else {
      for (const node of plan.wbsNodes) {
        if (!node.dri || node.dri.trim() === '') {
          violations.push(`WBS Task [${node.id}] violates Single DRI rule: DRI is missing or empty.`);
        }

        if (!node.binaryAcceptanceCriteria || node.binaryAcceptanceCriteria.length === 0) {
          violations.push(
            `WBS Task [${node.id}] violates Binary AC rule: No pass/fail acceptance criteria defined.`
          );
        }

        const pert = node.estimatedHours;
        if (pert) {
          if (pert.expectedHours < 0.5 || pert.expectedHours > 80) {
            violations.push(
              `WBS Task [${node.id}] violates 8/80 Rule: Expected hours (${pert.expectedHours}h) outside 0.5h - 80h bound.`
            );
          }

          // PERT Math validation
          const calculatedExpected = (pert.optimisticHours + 4 * pert.mostLikelyHours + pert.pessimisticHours) / 6;
          if (Math.abs(calculatedExpected - pert.expectedHours) > this.EPSILON) {
            violations.push(
              `WBS Task [${node.id}] has invalid PERT Expected calculation: Given ${pert.expectedHours}, Calculated ${calculatedExpected.toFixed(2)}`
            );
          }
        } else {
          violations.push(`WBS Task [${node.id}] missing PERT estimation.`);
        }
      }
    }

    // 5. RAID Log Completeness
    if (!plan.raidLog || plan.raidLog.length === 0) {
      violations.push('RAID Log invariant violated: Pre-Mortem analysis requires at least 1 RAID log entry.');
    } else {
      for (const item of plan.raidLog) {
        if (!item.ownerDRI || item.ownerDRI.trim() === '') {
          violations.push(`RAID item [${item.id}] must have an assigned ownerDRI.`);
        }
      }
    }

    return {
      valid: violations.length === 0,
      violations,
      haltRequired: false,
    };
  }
}
